import os
import secrets
import shutil
import time
import json
import threading
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4
from fastapi import FastAPI, Request, UploadFile, File, BackgroundTasks, Depends, HTTPException, Form, Query
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

import config
import services.job_store as job_store
from services.ocr import OCRService
from services.classifier import ClassificationService
from services.webhook_sender import (
    build_template_context,
    render_webhook_template,
    send_webhook,
)

app = FastAPI(title="ASA School Document Classifier")

SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".txt", ".docx", ".xlsx", ".xls"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}

# ── Admin authentication ──────────────────────────────────────────────────────

_http_basic = HTTPBasic(auto_error=False)

def verify_admin(credentials: Optional[HTTPBasicCredentials] = Depends(_http_basic)):
    """Dependency that enforces HTTP Basic Auth when ADMIN_USERNAME is configured."""
    if not config.ADMIN_USERNAME:
        return  # Auth disabled — open access
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": 'Basic realm="ASA Admin"'},
        )
    valid_user = secrets.compare_digest(
        credentials.username.encode("utf-8"), config.ADMIN_USERNAME.encode("utf-8")
    )
    valid_pass = secrets.compare_digest(
        credentials.password.encode("utf-8"), config.ADMIN_PASSWORD.encode("utf-8")
    )
    if not (valid_user and valid_pass):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials.",
            headers={"WWW-Authenticate": 'Basic realm="ASA Admin"'},
        )

# Initialize Services
ocr_svc = OCRService(remote_url=config.REMOTE_OCR_URL)
cls_svc = ClassificationService()


def extract_content(file_path: str) -> tuple:
    """
    Extract text content from a file for classification.
    For images: always tries vision model when enabled (photos produce garbage OCR).
      - If vision says it's a photo, use the vision description.
      - If vision says it's a document scan, prefer OCR text (fallback to vision content).
    For non-images: straight OCR/text extraction.
    Returns: (text, is_photo, vision_description)
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in IMAGE_EXTENSIONS and config.VISION_ENABLED:
        if config.DEBUG_MODE:
            print(f"[DEBUG] Image detected — running vision model first...")
        try:
            vision_result = cls_svc.analyse_image(file_path)
            content = vision_result.get("content", "")
            is_photo = vision_result.get("is_photo", False)
            if config.DEBUG_MODE:
                kind = "photograph" if is_photo else "document scan"
                print(f"[DEBUG] Vision model detected: {kind}")
            if is_photo:
                # It's a photo — use vision description, skip OCR entirely
                return content, True, content
            # It's a document scan — OCR may give better text than vision description
            ocr_text = ocr_svc.process(file_path)
            if ocr_text:
                if config.DEBUG_MODE:
                    print(f"[DEBUG] Using OCR text for document scan ({len(ocr_text)} chars).")
                return ocr_text, False, ""
            # OCR failed — fall back to vision content
            return content, False, ""
        except Exception as e:
            print(f"[!] Vision model failed: {e}")
            # Fall through to OCR

    text = ocr_svc.process(file_path)

    # If OCR returned nothing for a PDF and vision is enabled, the PDF is likely
    # a photo exported as PDF (e.g. iPhone IMG_xxxx.pdf). Render the first page
    # as an image and pass it through the vision model.
    if not text and ext == ".pdf" and config.VISION_ENABLED:
        img_path = file_path + "_p1.png"
        try:
            import fitz  # pymupdf
            doc = fitz.open(file_path)
            if len(doc) > 0:
                pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2))
                pix.save(img_path)
                doc.close()
                if config.DEBUG_MODE:
                    print(f"[DEBUG] OCR failed for PDF — trying vision model on rendered page 1.")
                vision_result = cls_svc.analyse_image(img_path)
                content = vision_result.get("content", "")
                is_photo = vision_result.get("is_photo", False)
                if content:
                    return content, is_photo, content if is_photo else ""
        except Exception as e:
            print(f"[!] Vision fallback for image-PDF failed: {e}")
        finally:
            if os.path.exists(img_path):
                os.remove(img_path)

    return text, False, ""


def process_file_pipeline(file_path: str):
    """
    The core pipeline: OCR -> RAG -> Export
    """
    filename = os.path.basename(file_path)
    if config.DEBUG_MODE:
        print(f"\n[DEBUG] >>> Pipeline Triggered for: {filename}")

    # 1. Extract content (OCR with vision fallback for images)
    text, is_photo, vision_description = extract_content(file_path)
    if not text:
        print(f"[!] Aborting: No text could be extracted from {filename}")
        return

    # 2. Classification via RAG (Rules + Examples) + LLM
    try:
        classify_result = cls_svc.classify(text, is_photo=is_photo)
        suggestions = classify_result["suggestions"]
        suggested_title = classify_result.get("suggested_title", "")
        top = suggestions[0] if suggestions else {}

        # 3. Export
        base_name = os.path.splitext(filename)[0]
        output_dir = os.path.join(config.PROCESSED_FOLDER, base_name)
        os.makedirs(output_dir, exist_ok=True)

        with open(os.path.join(output_dir, "classification.json"), "w") as f:
            output = {
                "suggested_title": suggested_title,
                "suggestions": suggestions,
                "ocr_text_extracted": text,
                "is_photo": is_photo,
            }
            if vision_description:
                output["vision_description"] = vision_description
            json.dump(output, f, indent=4)

        shutil.move(file_path, os.path.join(output_dir, filename))
        if config.DEBUG_MODE:
            print(f"[DEBUG] Export complete. Moved to {output_dir}")
        print(f"[+] Done: {filename} classified as {top.get('asa_code')} ({top.get('confidence', 0)*100:.0f}%)")

    except Exception as e:
        print(f"[!] Classification failed for {filename}: {e}")


# --- API ENDPOINTS ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/settings")
async def public_settings():
    """Public settings consumed by the frontend to configure UI behaviour."""
    return {
        "allow_user_training": config.ALLOW_USER_TRAINING,
        "admin_auth_enabled": bool(config.ADMIN_USERNAME),
    }


# ── Embedding rebuild state ──────────────────────────────────────────────────
_rebuild_state = {"status": "idle", "log": [], "error": None}
_rebuild_lock = threading.Lock()


@app.get("/api/admin/rebuild-status")
async def rebuild_status(_: None = Depends(verify_admin)):
    return _rebuild_state


@app.post("/api/admin/rebuild-embeddings")
async def rebuild_embeddings(background_tasks: BackgroundTasks, _: None = Depends(verify_admin)):
    with _rebuild_lock:
        if _rebuild_state["status"] == "running":
            raise HTTPException(status_code=409, detail="Rebuild already in progress.")
        _rebuild_state.update({"status": "running", "log": [], "error": None})

    def run():
        def on_progress(msg):
            _rebuild_state["log"].append(msg)

        try:
            cls_svc.rebuild_embeddings(progress_callback=on_progress)
            _rebuild_state["status"] = "done"
        except Exception as e:
            _rebuild_state["status"] = "error"
            _rebuild_state["error"] = str(e)
            print(f"[!] Rebuild failed: {e}")

    background_tasks.add_task(run)


@app.get("/api/admin/export-examples")
async def export_examples(_: None = Depends(verify_admin)):
    """Export all training examples as a downloadable JSON file."""
    data = cls_svc.export_examples()
    payload = json.dumps({"version": 1, "examples": data}, indent=2)
    return JSONResponse(
        content=json.loads(payload),
        headers={"Content-Disposition": "attachment; filename=asa_training_examples.json"}
    )


@app.post("/api/admin/import-examples")
async def import_examples(file: UploadFile = File(...), _: None = Depends(verify_admin)):
    """Import training examples from a JSON file produced by export."""
    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="File must be a .json export.")
    try:
        raw = await file.read()
        payload = json.loads(raw)
        examples = payload.get("examples", [])
        if not isinstance(examples, list):
            raise ValueError("Invalid format: expected 'examples' array.")
        result = cls_svc.import_examples(examples)
        return result
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid export file: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


@app.post("/api/upload")
async def upload_document(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Manual upload via API. Queues the file for background processing."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    file_path = os.path.join(config.INPUT_FOLDER, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    background_tasks.add_task(process_file_pipeline, file_path)
    return {"message": "File uploaded and added to processing queue.", "filename": file.filename}


@app.post("/api/analyse")
async def analyse_document(file: UploadFile = File(...)):
    """Upload a document and receive classification results synchronously."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    file_path = os.path.join(config.TEMP_FOLDER, f"{uuid4().hex}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        t_start = time.time()
        text, is_photo, vision_description = extract_content(file_path)
        if not text:
            raise HTTPException(status_code=422, detail="No text could be extracted from the document.")

        classify_result = cls_svc.classify(text, is_photo=is_photo)
        return {
            "suggested_title": classify_result.get("suggested_title", ""),
            "suggestions": classify_result["suggestions"],
            "filename": file.filename,
            "is_photo": is_photo,
            "vision_description": vision_description or None,
            "llm_model": config.LLM_MODEL,
            "processing_time_seconds": round(time.time() - t_start, 2),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification failed: {e}")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/train")
async def train_document(file: UploadFile = File(...), asa_code: str = Form(""), archive: bool = Form(True)):
    """Upload a document with a known ASA code so the system can learn from it."""
    if not config.ALLOW_USER_TRAINING:
        raise HTTPException(status_code=403, detail="User training is disabled.")
    if not asa_code:
        raise HTTPException(status_code=400, detail="asa_code is required.")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    file_path = os.path.join(config.TEMP_FOLDER, f"{uuid4().hex}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    archive_path = None
    try:
        if archive:
            archive_dir = os.path.join(config.TRAINING_ARCHIVE_FOLDER, asa_code)
            os.makedirs(archive_dir, exist_ok=True)
            unique_filename = f"{uuid4().hex}_{file.filename}"
            archive_path = os.path.join(archive_dir, unique_filename)
            shutil.copy2(file_path, archive_path)

        text = ocr_svc.process(file_path)
        if not text:
            raise HTTPException(status_code=422, detail="No text could be extracted from the document.")

        result = cls_svc.learn_from_example(text, asa_code, filename=file.filename, archive_path=archive_path)
        return {"status": result["status"], "message": result["message"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training failed: {e}")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/train/bulk")
async def train_bulk(files: List[UploadFile] = File(...), asa_code: str = Form(""), archive: bool = Form(True), _: None = Depends(verify_admin)):
    """Upload multiple documents with a known ASA code for bulk training."""
    if not asa_code:
        raise HTTPException(status_code=400, detail="asa_code is required.")

    succeeded = []
    duplicates = []
    failed = []

    for file in files:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            failed.append({"filename": file.filename, "error": f"Unsupported file type: {ext}"})
            continue

        file_path = os.path.join(config.TEMP_FOLDER, f"{uuid4().hex}_{file.filename}")
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        archive_path = None
        try:
            if archive:
                archive_dir = os.path.join(config.TRAINING_ARCHIVE_FOLDER, asa_code)
                os.makedirs(archive_dir, exist_ok=True)
                unique_filename = f"{uuid4().hex}_{file.filename}"
                archive_path = os.path.join(archive_dir, unique_filename)
                shutil.copy2(file_path, archive_path)

            text = ocr_svc.process(file_path)
            if not text:
                failed.append({"filename": file.filename, "error": "No text could be extracted."})
                continue

            result = cls_svc.learn_from_example(text, asa_code, filename=file.filename, archive_path=archive_path)
            if result["status"] == "added":
                succeeded.append(file.filename)
            elif result["status"] in ("exact_duplicate", "near_duplicate"):
                duplicates.append({"filename": file.filename, "reason": result["message"]})
            else:
                failed.append({"filename": file.filename, "error": result.get("message", "Unknown error")})
        except Exception as e:
            failed.append({"filename": file.filename, "error": str(e)})
        finally:
            if os.path.exists(file_path):
                os.remove(file_path)

    return {"succeeded": succeeded, "duplicates": duplicates, "failed": failed}


@app.get("/api/training/codes")
async def get_training_codes(_: None = Depends(verify_admin)):
    """Returns all ASA codes with example counts and last trained timestamp."""
    return cls_svc.list_codes()


@app.get("/api/training/codes/{code}/examples")
async def get_code_examples(code: str, _: None = Depends(verify_admin)):
    """Returns all training examples for a given ASA code."""
    return cls_svc.list_examples(code)


@app.delete("/api/training/examples/{example_id}")
async def delete_training_example(example_id: str, delete_file: bool = Query(False), _: None = Depends(verify_admin)):
    """Deletes a training example. Optionally deletes the archived file."""
    if delete_file:
        example = cls_svc.get_example(example_id)
        if example and example.get("archive_path"):
            archive_path = example["archive_path"]
            if os.path.exists(archive_path):
                os.remove(archive_path)
    cls_svc.delete_example(example_id)
    return {"message": "Deleted."}


@app.get("/api/training/examples/{example_id}/file")
async def get_example_file(example_id: str, _: None = Depends(verify_admin)):
    """Serves the archived file for a training example."""
    example = cls_svc.get_example(example_id)
    if not example or not example.get("archive_path"):
        raise HTTPException(status_code=404, detail="No archived file for this example.")
    archive_path = example["archive_path"]
    if not os.path.exists(archive_path):
        raise HTTPException(status_code=404, detail="Archived file not found on disk.")
    return FileResponse(archive_path)


@app.get("/api/asa-codes")
async def get_asa_codes(q: str = Query("")):
    """Return all ASA codes, or search by query string."""
    if q:
        return cls_svc.search_codes(q)
    return [
        {"asa_code": code, **meta}
        for code, meta in cls_svc.code_to_meta.items()
    ]


@app.post("/api/suggest")
async def suggest_codes(description: str = Form(...)):
    """Return top 3 ASA code suggestions for a plain-text document description."""
    if not description.strip():
        raise HTTPException(status_code=400, detail="Description is required.")
    try:
        suggestions = cls_svc.suggest(description)
        return {"suggestions": suggestions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Suggestion failed: {e}")


# ── Webhook template management ───────────────────────────────────────────────

def _load_custom_templates() -> dict:
    """Load custom templates from the JSON file; return empty dict on failure."""
    try:
        if os.path.exists(config.WEBHOOK_TEMPLATES_FILE):
            with open(config.WEBHOOK_TEMPLATES_FILE) as f:
                return json.load(f)
    except Exception as e:
        print(f"[!] Failed to load webhook templates: {e}")
    return {}


def _save_custom_templates(templates: dict) -> None:
    with open(config.WEBHOOK_TEMPLATES_FILE, "w") as f:
        json.dump(templates, f, indent=2)


def _resolve_template(name: str) -> Optional[str]:
    """
    Resolve a template name → Jinja2 body string.
    Lookup order: custom file → built-in defaults → treat name as raw template string.
    """
    custom = _load_custom_templates()
    if name in custom:
        return custom[name].get("body", "")
    if name in config.DEFAULT_WEBHOOK_TEMPLATES:
        return config.DEFAULT_WEBHOOK_TEMPLATES[name].get("body", "")
    # Fall back: treat the value itself as a raw Jinja2 template
    return name


@app.get("/api/admin/webhook-templates")
async def list_webhook_templates(_: None = Depends(verify_admin)):
    """Return all available webhook templates (built-ins + custom)."""
    custom = _load_custom_templates()
    result = {}
    for name, tpl in config.DEFAULT_WEBHOOK_TEMPLATES.items():
        result[name] = {**tpl, "builtin": True, "custom": name in custom}
    for name, tpl in custom.items():
        if name not in result:
            result[name] = {**tpl, "builtin": False, "custom": True}
    return result


@app.put("/api/admin/webhook-templates/{name}")
async def save_webhook_template(name: str, body: dict, _: None = Depends(verify_admin)):
    """Create or update a custom webhook template."""
    custom = _load_custom_templates()
    custom[name] = {
        "description": body.get("description", ""),
        "body": body.get("body", ""),
    }
    _save_custom_templates(custom)
    return {"message": f"Template '{name}' saved."}


@app.delete("/api/admin/webhook-templates/{name}")
async def delete_webhook_template(name: str, _: None = Depends(verify_admin)):
    """Delete a custom webhook template. Built-in templates cannot be deleted."""
    if name in config.DEFAULT_WEBHOOK_TEMPLATES:
        raise HTTPException(status_code=400, detail="Built-in templates cannot be deleted.")
    custom = _load_custom_templates()
    if name not in custom:
        raise HTTPException(status_code=404, detail="Template not found.")
    del custom[name]
    _save_custom_templates(custom)
    return {"message": f"Template '{name}' deleted."}


# ── Jobs: submit / verify / confirm ──────────────────────────────────────────

class ConfirmRequest(BaseModel):
    confirmed_code: str
    confirmed_hierarchy: str = ""
    confirmed_disposal: str = ""
    train: bool = False
    train_archive: bool = True


def _post_confirm_background(
    job: dict,
    job_id: str,
    confirmed_code: str,
    confirmed_hierarchy: str,
    confirmed_disposal: str,
    train: bool,
    train_archive: bool,
):
    """Background task: optionally train, fire webhook (Jinja2 or generic), delete job + document."""
    doc_path = job.get("document_path")

    # 1. Train (must happen before document is deleted)
    if train and doc_path and os.path.exists(doc_path):
        try:
            archive_path = None
            if train_archive:
                archive_dir = os.path.join(config.TRAINING_ARCHIVE_FOLDER, confirmed_code)
                os.makedirs(archive_dir, exist_ok=True)
                unique_name = f"{uuid4().hex}_{job['filename']}"
                archive_path = os.path.join(archive_dir, unique_name)
                shutil.copy2(doc_path, archive_path)
            text = ocr_svc.process(doc_path)
            if text:
                cls_svc.learn_from_example(
                    text, confirmed_code,
                    filename=job["filename"],
                    archive_path=archive_path,
                )
        except Exception as e:
            print(f"[!] Post-confirm training failed: {e}")

    # 2. Fire webhook
    if job.get("webhook_url"):
        template_name = job.get("webhook_template")
        if template_name:
            # Jinja2 template path — used for Therefore DMS integration
            try:
                template_str = _resolve_template(template_name)
                ctx = build_template_context(job, confirmed_code, confirmed_hierarchy, confirmed_disposal)
                raw_body = render_webhook_template(
                    template_str,
                    ctx,
                    pre_fetch_url=job.get("webhook_pre_fetch_url"),
                    pre_fetch_headers=job.get("webhook_pre_fetch_headers") or {},
                    pre_fetch_method=job.get("webhook_pre_fetch_method") or "GET",
                    pre_fetch_body=job.get("webhook_pre_fetch_body"),
                )
                _, status_code = send_webhook(
                    url=job["webhook_url"],
                    payload={},
                    secret=job.get("webhook_secret"),
                    extra_headers=job.get("webhook_headers") or {},
                    raw_body=raw_body,
                )
            except Exception as e:
                print(f"[!] Webhook template render/send failed: {e}")
                status_code = None
        else:
            # Generic JSON payload — non-Therefore integrations
            meta = job.get("metadata") or {}
            payload = {
                "event": "job.confirmed",
                "job_id": job.get("id", ""),
                "filename": job.get("filename", ""),
                "confirmed_code": confirmed_code,
                "confirmed_hierarchy": confirmed_hierarchy,
                "confirmed_disposal": confirmed_disposal,
                "confirmed_at": datetime.now(timezone.utc).isoformat(),
                "metadata": meta,
            }
            payload.update(job.get("webhook_extra") or {})
            _, status_code = send_webhook(
                url=job["webhook_url"],
                payload=payload,
                secret=job.get("webhook_secret"),
                extra_headers=job.get("webhook_headers") or {},
            )

        try:
            job_store.mark_webhook_sent(job_id, status_code or 0)
        except Exception:
            pass

    # 3. Delete document from disk
    if doc_path and os.path.exists(doc_path):
        try:
            os.remove(doc_path)
            folder = os.path.dirname(doc_path)
            if os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        except Exception as e:
            print(f"[!] Failed to delete job document {doc_path}: {e}")

    # 4. Delete job record
    try:
        job_store.delete_job(job_id)
    except Exception as e:
        print(f"[!] Failed to delete job record {job_id}: {e}")


def _parse_json_field(raw: Optional[str], default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def _collect_prefixed(form_data, prefix: str) -> dict:
    """Extract webhook_header_<Name> or webhook_extra_<key> fields from raw form data."""
    result = {}
    for key, value in form_data.multi_items():
        if key.startswith(prefix):
            name = key[len(prefix):]
            if name:
                result[name] = str(value)
    return result


@app.post("/api/jobs/submit")
async def submit_job(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    # All parameters below also fall back to the `metadata` JSON envelope.
    # Therefore's REST Call task sends all parameters inside a single metadata
    # JSON part rather than individual form fields.  Direct form fields take
    # precedence; metadata envelope is the fallback.
    # Use Optional[str] for booleans/floats so None means "not provided"
    # (FastAPI would coerce a missing bool field to False, masking the fallback).
    verify: Optional[str] = Form(None),
    auto_confirm_threshold: Optional[str] = Form(None),
    webhook_url: Optional[str] = Form(None),
    webhook_headers: Optional[str] = Form(None),
    webhook_secret: Optional[str] = Form(None),
    webhook_extra: Optional[str] = Form(None),
    webhook_template: Optional[str] = Form(None),
    webhook_pre_fetch_url: Optional[str] = Form(None),
    webhook_pre_fetch_headers: Optional[str] = Form(None),
    webhook_pre_fetch_method: Optional[str] = Form(None),
    webhook_pre_fetch_body: Optional[str] = Form(None),
    metadata: Optional[str] = Form(None),
):
    """
    Submit a document for classification with optional verification.

    verify=false (default): classify immediately, fire webhook if provided, return result.
    verify=true: store document and return verify_url for human review.
      auto_confirm_threshold (0-100): if set and top confidence >= threshold, skips verification.

    Therefore integration — parameter passing
    ─────────────────────────────────────────
    Three equivalent ways to supply parameters (can be mixed):

    1. Individual form fields — straightforward for non-Therefore clients.
    2. metadata JSON envelope — Therefore sends ALL parameters as a single JSON
       object in the "metadata" multipart part. Direct form fields take precedence.
    3. Prefixed form fields — Therefore's REST Call task corrupts JSON string
       values, so headers and extra vars MUST use prefixed fields:
         webhook_header_Authorization   Basic dXNlcjpwYXNz
         webhook_header_TenantName      acme
         webhook_header_Content-Type    application/json
         webhook_extra_doc_no           %DocNo%
         webhook_pre_fetch_header_Authorization  Basic dXNlcjpwYXNz
         webhook_pre_fetch_header_TenantName     acme
       Prefixed form fields take precedence over the JSON envelope equivalents.
    """
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # ── Parse metadata envelope first; all params fall back to it ────────────
    meta = _parse_json_field(metadata, {})

    def _get(direct_value: Optional[str], key: str, default=None):
        """Return direct form value if provided, else metadata envelope value, else default."""
        if direct_value is not None:
            return direct_value
        return meta.get(key, default)

    def _bool(v) -> bool:
        return str(v).lower() in ("true", "1", "yes")

    def _float_or_none(v) -> Optional[float]:
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    verify_flag         = _bool(_get(verify, "verify", "false"))
    auto_threshold      = _float_or_none(_get(auto_confirm_threshold, "auto_confirm_threshold"))
    webhook_url         = _get(webhook_url, "webhook_url")
    webhook_secret      = _get(webhook_secret, "webhook_secret")
    webhook_template    = _get(webhook_template, "webhook_template")
    webhook_pre_fetch_url    = _get(webhook_pre_fetch_url, "webhook_pre_fetch_url")
    webhook_pre_fetch_method = _get(webhook_pre_fetch_method, "webhook_pre_fetch_method") or "GET"
    webhook_pre_fetch_body   = _get(webhook_pre_fetch_body, "webhook_pre_fetch_body")

    # JSON dict fields — parse if provided, then overlay with prefixed form fields.
    # webhook_headers / webhook_extra / webhook_pre_fetch_headers arrive as JSON
    # strings from non-Therefore clients, but Therefore mangles JSON field values
    # in its REST Call task — use prefixed fields for Therefore instead.
    wh_headers       = _parse_json_field(_get(webhook_headers,       "webhook_headers"),       {})
    wh_extra         = _parse_json_field(_get(webhook_extra,         "webhook_extra"),         {})
    wh_pf_headers    = _parse_json_field(_get(webhook_pre_fetch_headers, "webhook_pre_fetch_headers"), {})

    # Also extract prefixed keys embedded inside the metadata envelope itself
    # (Therefore sometimes puts webhook_header_* keys inside the JSON blob).
    meta_wh_headers  = _collect_prefixed(meta, "webhook_header_")
    meta_wh_extra    = _collect_prefixed(meta, "webhook_extra_")
    meta_pf_headers  = _collect_prefixed(meta, "webhook_pre_fetch_header_")

    # Collect prefixed form fields from the raw multipart data.
    # These take final precedence — most explicit, least likely to be mangled.
    try:
        form_data = await request.form()
        form_wh_headers = _collect_prefixed(form_data, "webhook_header_")
        form_wh_extra   = _collect_prefixed(form_data, "webhook_extra_")
        form_pf_headers = _collect_prefixed(form_data, "webhook_pre_fetch_header_")
    except Exception:
        form_wh_headers = form_wh_extra = form_pf_headers = {}

    # Merge order: JSON field < envelope prefixed < form prefixed
    wh_headers    = {**wh_headers,    **meta_wh_headers,  **form_wh_headers}
    wh_extra      = {**wh_extra,      **meta_wh_extra,    **form_wh_extra}
    wh_pf_headers = {**wh_pf_headers, **meta_pf_headers,  **form_pf_headers}

    temp_path = os.path.join(config.TEMP_FOLDER, f"{uuid4().hex}_{file.filename}")
    with open(temp_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    try:
        t_start = time.time()
        text, is_photo, vision_description = extract_content(temp_path)
        if not text:
            raise HTTPException(status_code=422, detail="No text could be extracted from the document.")

        classify_result = cls_svc.classify(text, is_photo=is_photo)
        suggestions = classify_result["suggestions"]
        suggested_title = classify_result.get("suggested_title", "")
        top = suggestions[0] if suggestions else {}

        # Determine if verification is required
        needs_verify = verify_flag
        if needs_verify and auto_threshold is not None:
            top_conf_pct = (top.get("confidence") or 0) * 100
            if top_conf_pct >= auto_threshold:
                needs_verify = False

        if not needs_verify:
            result = {
                "suggested_title": suggested_title,
                "suggestions": suggestions,
                "filename": file.filename,
                "is_photo": is_photo,
                "vision_description": vision_description or None,
                "llm_model": config.LLM_MODEL,
                "processing_time_seconds": round(time.time() - t_start, 2),
            }
            if webhook_url:
                # For no-verify, fire webhook with top suggestion as confirmed result
                dummy_job = {
                    "id": uuid4().hex,
                    "filename": file.filename,
                    "metadata": meta,
                    "webhook_extra": wh_extra,
                    "confirmed_at": datetime.now(timezone.utc).isoformat(),
                }
                if webhook_template:
                    try:
                        template_str = _resolve_template(webhook_template)
                        ctx = build_template_context(
                            dummy_job,
                            top.get("asa_code", ""),
                            top.get("hierarchy", ""),
                            top.get("disposal_action", ""),
                        )
                        raw_body = render_webhook_template(
                            template_str, ctx,
                            pre_fetch_url=webhook_pre_fetch_url,
                            pre_fetch_headers=wh_pf_headers,
                            pre_fetch_method=webhook_pre_fetch_method,
                            pre_fetch_body=webhook_pre_fetch_body,
                        )
                        background_tasks.add_task(
                            send_webhook, webhook_url, {}, webhook_secret, wh_headers, 3, raw_body
                        )
                    except Exception as e:
                        print(f"[!] No-verify webhook template error: {e}")
                else:
                    payload = {
                        "event": "job.confirmed",
                        "job_id": dummy_job["id"],
                        "filename": file.filename,
                        "confirmed_code": top.get("asa_code", ""),
                        "confirmed_hierarchy": top.get("hierarchy", ""),
                        "confirmed_disposal": top.get("disposal_action", ""),
                        "confirmed_at": dummy_job["confirmed_at"],
                        "metadata": meta,
                    }
                    payload.update(wh_extra)
                    background_tasks.add_task(send_webhook, webhook_url, payload, webhook_secret, wh_headers)
                result["webhook_queued"] = True
            else:
                result["webhook_queued"] = False
            return result

        # Verification required — persist document and job record
        job_id = str(uuid4())
        job_folder = os.path.join(config.JOBS_FOLDER, job_id)
        os.makedirs(job_folder, exist_ok=True)
        doc_path = os.path.join(job_folder, file.filename)
        shutil.copy2(temp_path, doc_path)

        meta["is_photo"] = is_photo
        meta["suggested_title"] = suggested_title
        if vision_description:
            meta["vision_description"] = vision_description

        job_store.create_job(
            job_id=job_id,
            filename=file.filename,
            file_ext=ext,
            document_path=doc_path,
            suggestions=suggestions,
            extracted_text=text,
            webhook_url=webhook_url,
            webhook_headers=wh_headers,
            webhook_secret=webhook_secret,
            webhook_extra=wh_extra,
            webhook_template=webhook_template,
            webhook_pre_fetch_url=webhook_pre_fetch_url,
            webhook_pre_fetch_headers=wh_pf_headers,
            webhook_pre_fetch_method=webhook_pre_fetch_method,
            webhook_pre_fetch_body=webhook_pre_fetch_body,
            metadata=meta,
        )

        return {
            "job_id": job_id,
            "verify_url": f"/verify/{job_id}",
            "suggested_title": suggested_title,
            "suggestions": suggestions,
            "filename": file.filename,
            "is_photo": is_photo,
            "vision_description": vision_description or None,
            "webhook_queued": False,
            "llm_model": config.LLM_MODEL,
            "processing_time_seconds": round(time.time() - t_start, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Submission failed: {e}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    """Return job details for the verification page."""
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "job_id": job["id"],
        "filename": job["filename"],
        "file_ext": job["file_ext"],
        "status": job["status"],
        "suggested_title": (job.get("metadata") or {}).get("suggested_title", ""),
        "suggestions": job["suggestions"],
        "metadata": job["metadata"],
        "created_at": job["created_at"],
    }


@app.get("/api/jobs/{job_id}/document")
async def get_job_document(job_id: str):
    """Serve the stored document for inline preview on the verification page."""
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    doc_path = job.get("document_path")
    if not doc_path or not os.path.exists(doc_path):
        raise HTTPException(status_code=404, detail="Document not found on disk.")
    mime_map = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".txt": "text/plain",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
    }
    mime = mime_map.get(job["file_ext"].lower(), "application/octet-stream")
    return FileResponse(
        doc_path,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{job["filename"]}"'},
    )


@app.post("/api/jobs/{job_id}/confirm")
async def confirm_job_endpoint(job_id: str, body: ConfirmRequest, background_tasks: BackgroundTasks):
    """
    Confirm a classification. Fires webhook and deletes job + document in background.
    Optionally trains the system with the confirmed result.
    """
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job["status"] != "pending_verification":
        raise HTTPException(status_code=400, detail=f"Job status is '{job['status']}', not pending.")

    job_store.confirm_job(job_id, body.confirmed_code, body.confirmed_hierarchy, body.confirmed_disposal)

    background_tasks.add_task(
        _post_confirm_background,
        job, job_id,
        body.confirmed_code,
        body.confirmed_hierarchy,
        body.confirmed_disposal,
        body.train,
        body.train_archive,
    )

    return {"status": "confirmed", "confirmed_code": body.confirmed_code}


def process_training_file(file_path: str):
    """
    Processes a file dropped into a training subfolder.
    The parent folder name is used as the ASA Code.
    """
    filename = os.path.basename(file_path)
    parent_dir = os.path.basename(os.path.dirname(file_path))

    if parent_dir == os.path.basename(config.TRAINING_FOLDER):
        return

    if config.DEBUG_MODE:
        print(f"\n[DEBUG] >>> Training Ingestion Triggered: {filename} for Code: {parent_dir}")

    try:
        text = ocr_svc.process(file_path)
        if not text:
            print(f"[!] No text extracted from training file: {filename}")
            return

        cls_svc.learn_from_example(text, parent_dir)

        os.remove(file_path)
        if config.DEBUG_MODE:
            print(f"[DEBUG] Training file deleted after ingestion: {file_path}")
    except Exception as e:
        print(f"[!] Training ingestion failed for {filename}: {e}")


def _wait_for_file_ready(file_path: str, timeout: int = 30) -> bool:
    """Wait until a file stops growing, indicating the write is complete."""
    deadline = time.time() + timeout
    last_size = -1
    while time.time() < deadline:
        try:
            current_size = os.path.getsize(file_path)
        except OSError:
            time.sleep(0.5)
            continue
        if current_size == last_size and current_size > 0:
            return True
        last_size = current_size
        time.sleep(0.5)
    return False


# --- FOLDER WATCHER ---
class NewFileHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and os.path.splitext(event.src_path)[1].lower() in SUPPORTED_EXTENSIONS:
            if not _wait_for_file_ready(event.src_path):
                print(f"[!] Timed out waiting for file to be ready: {event.src_path}")
                return
            if config.TRAINING_FOLDER in event.src_path:
                process_training_file(event.src_path)
            else:
                process_file_pipeline(event.src_path)


def start_watcher():
    os.makedirs(config.TRAINING_FOLDER, exist_ok=True)
    observer = Observer()
    handler = NewFileHandler()
    observer.schedule(handler, config.INPUT_FOLDER, recursive=False)
    observer.schedule(handler, config.TRAINING_FOLDER, recursive=True)
    observer.start()
    print(f"[*] Watchers started: {config.INPUT_FOLDER} (Input) and {config.TRAINING_FOLDER} (Training)")
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


# Start the folder watcher in a background thread
watcher_thread = threading.Thread(target=start_watcher, daemon=True)
watcher_thread.start()

# --- FRONTEND ---
# Serve the React SPA for all non-API routes.
# /          -> user portal (default)
# /admin/    -> admin dashboard
# API routes are prefixed with /api/ and matched before this catch-all.
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{path:path}")
    async def serve_spa(path: str):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
