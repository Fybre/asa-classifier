import json
import os
import re
import unicodedata
import base64
import openai
from datetime import datetime, timezone
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document
import config

import hashlib

# Approximate character budget for 512 tokens (avg ~4 chars/token)
_EMBED_CHAR_LIMIT = 2000

# Relevance score (0-1) above which two documents are considered near-duplicates.
# Scores this high indicate near-identical content from different OCR passes of the same
# physical document. Distinct-but-related documents (e.g. two different invoices) typically
# score below 0.95.
_NEAR_DUPLICATE_THRESHOLD = 0.97

# Patterns that look like page headers/footers from OCR output
_HEADER_FOOTER_RE = re.compile(
    r'(?im)'                              # multiline, case-insensitive
    r'^(page\s+\d+(\s+of\s+\d+)?'        # "Page 1 of 5"
    r'|\d+\s*/\s*\d+'                     # "1/5"
    r'|confidential\b'                    # "CONFIDENTIAL"
    r'|draft\b'                           # "DRAFT"
    r'|private\s+and\s+confidential\b'   # "Private and Confidential"
    r')\s*$'
)


def clean_for_embedding(text: str) -> str:
    """
    Normalise and clean OCR/extracted text before embedding.
    - Normalise unicode (curly quotes, ligatures, em-dashes → ASCII equivalents)
    - Strip non-printable / control characters
    - Remove likely page headers and footers
    - Collapse excessive whitespace and blank lines
    - Truncate to _EMBED_CHAR_LIMIT characters
    """
    # Unicode normalisation — NFKC converts ligatures, curly quotes, etc.
    text = unicodedata.normalize('NFKC', text)

    # Remove control characters except newline and tab
    text = ''.join(ch for ch in text if ch == '\n' or ch == '\t' or not unicodedata.category(ch).startswith('C'))

    # Strip lines that look like headers/footers
    text = _HEADER_FOOTER_RE.sub('', text)

    # Collapse runs of whitespace within lines, then collapse blank lines
    lines = [' '.join(line.split()) for line in text.splitlines()]
    # Remove empty lines and very short lines (single chars, lone numbers — OCR noise)
    lines = [l for l in lines if len(l) > 2]
    text = '\n'.join(lines)

    # Truncate to character budget
    if len(text) > _EMBED_CHAR_LIMIT:
        text = text[:_EMBED_CHAR_LIMIT]

    return text.strip()


class ClassificationService:
    def __init__(self):
        self.embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L12-v2")
        self.db_rules = Chroma(collection_name="asa_rules", persist_directory=config.VECTOR_DB_PATH, embedding_function=self.embeddings)
        self.db_examples = Chroma(collection_name="asa_examples", persist_directory=config.VECTOR_DB_PATH, embedding_function=self.embeddings)
        
        # Mapping for Code -> Official Metadata
        try:
            with open("asa_codes_full_list.json", 'r') as f:
                raw = json.load(f)
            # Strip "nan" strings that pandas sometimes writes for empty cells
            self.code_to_meta = {
                code: {k: (v if str(v).lower() != 'nan' else '') for k, v in meta.items()}
                for code, meta in raw.items()
            }
        except Exception as e:
            if config.DEBUG_MODE:
                print(f"[DEBUG] [Warning] Could not load full ASA code list: {e}")
            self.code_to_meta = {}
        
        self.client = openai.OpenAI(
            api_key=config.OPENAI_API_KEY,
            base_url=config.OPENAI_API_BASE
        )

        # Separate client for vision — same endpoint, different model
        self.vision_client = openai.OpenAI(
            api_key=config.OPENAI_API_KEY,
            base_url=config.OPENAI_API_BASE
        ) if config.VISION_ENABLED else None

    def _parse_json(self, text: str) -> dict:
        """Parse JSON from LLM response, stripping markdown code blocks if present."""
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1]
            text = text.rsplit("```", 1)[0].strip()
        return json.loads(text)

    def _generate_text_hash(self, text: str) -> str:
        """Generates a unique SHA-256 hash for a block of text."""
        return hashlib.sha256(text.encode('utf-8')).hexdigest()

    def learn_from_example(self, ocr_text: str, asa_code: str, filename: str = None, archive_path: str = None) -> dict:
        """
        Adds a confirmed classification to the 'Examples' vector store.

        De-duplication strategy (in order):
        1. Clean text first so the hash is stable regardless of OCR noise.
        2. Exact-duplicate check: SHA-256 of the cleaned text is used as the document ID.
        3. Near-duplicate check: cosine similarity search against existing examples for
           the same ASA code.  A score >= _NEAR_DUPLICATE_THRESHOLD means the same
           physical document was scanned/uploaded again.

        Returns a dict with keys:
          status  — "added" | "exact_duplicate" | "near_duplicate"
          message — human-readable explanation
          (near_duplicate also includes: similarity, similar_filename)
        """
        # 1. Clean first — the ID and embedding are both based on cleaned text
        embed_text = clean_for_embedding(ocr_text)
        if not embed_text:
            return {"status": "error", "message": "No extractable text content after cleaning."}

        text_id = self._generate_text_hash(embed_text)

        # 2. Exact duplicate check
        existing = self.db_examples.get(ids=[text_id])
        if existing and len(existing['ids']) > 0:
            if config.DEBUG_MODE:
                print(f"[DEBUG] Exact duplicate: document already in training set (ID: {text_id[:8]})")
            return {"status": "exact_duplicate", "message": "This document is already in the training set (identical content)."}

        # 3. Near-duplicate check (same ASA code, very high similarity)
        try:
            similar = self.db_examples.similarity_search_with_relevance_scores(
                embed_text, k=1, filter={"asa_code": asa_code}
            )
            if similar:
                near_doc, score = similar[0]
                if score >= _NEAR_DUPLICATE_THRESHOLD:
                    similar_file = near_doc.metadata.get("filename") or "unknown"
                    if config.DEBUG_MODE:
                        print(f"[DEBUG] Near-duplicate: score={score:.3f} vs '{similar_file}'")
                    return {
                        "status": "near_duplicate",
                        "message": (
                            f"A very similar document is already in the training set "
                            f"(similarity {score:.0%}, file: \"{similar_file}\"). Skipped."
                        ),
                        "similarity": round(score, 4),
                        "similar_filename": similar_file,
                    }
        except Exception as e:
            if config.DEBUG_MODE:
                print(f"[DEBUG] Near-duplicate check error (continuing): {e}")

        # 4. Store new example
        if config.DEBUG_MODE:
            print(f"[DEBUG] Embedding {len(embed_text)} chars (from {len(ocr_text)} raw) for training example.")

        meta = self.code_to_meta.get(asa_code, {})
        hierarchy = meta.get("hierarchy", "Unknown")
        timestamp = datetime.now(timezone.utc).isoformat()

        metadata = {
            "asa_code": asa_code,
            "hierarchy": hierarchy,
            "disposal": meta.get("disposal_action", "Consult ASA Schedule"),
            "timestamp": timestamp,
        }
        if filename is not None:
            metadata["filename"] = filename
        if archive_path is not None:
            metadata["archive_path"] = archive_path

        doc = Document(page_content=embed_text, metadata=metadata)
        self.db_examples.add_documents([doc], ids=[text_id])
        print(f"[Feedback] Learned new unique example for Code {asa_code} (ID: {text_id[:8]})")
        return {"status": "added", "message": f"Added as training example for {asa_code}."}

    def list_codes(self):
        """
        Returns aggregated list of all ASA codes in the examples store.
        """
        result = self.db_examples._collection.get(include=["metadatas"])
        aggregated = {}
        for meta in result.get("metadatas", []):
            code = meta.get("asa_code", "Unknown")
            ts = meta.get("timestamp", "")
            if code not in aggregated:
                aggregated[code] = {
                    "asa_code": code,
                    "hierarchy": meta.get("hierarchy", "Unknown"),
                    "count": 0,
                    "last_trained": ts,
                }
            aggregated[code]["count"] += 1
            if ts > aggregated[code]["last_trained"]:
                aggregated[code]["last_trained"] = ts
        return sorted(aggregated.values(), key=lambda x: x["asa_code"])

    def list_examples(self, asa_code: str):
        """
        Returns all examples for a given ASA code.
        """
        result = self.db_examples._collection.get(
            where={"asa_code": asa_code},
            include=["metadatas", "documents"]
        )
        examples = []
        ids = result.get("ids", [])
        metadatas = result.get("metadatas", [])
        documents = result.get("documents", [])
        for i, doc_id in enumerate(ids):
            meta = metadatas[i] if i < len(metadatas) else {}
            text = documents[i] if i < len(documents) else ""
            examples.append({
                "id": doc_id,
                "filename": meta.get("filename"),
                "timestamp": meta.get("timestamp", ""),
                "archive_path": meta.get("archive_path"),
                "text_preview": text[:200] if text else "",
            })
        examples.sort(key=lambda x: x["timestamp"], reverse=True)
        return examples

    def get_example(self, example_id: str):
        """
        Returns a single example's metadata dict, or None if not found.
        """
        result = self.db_examples._collection.get(
            ids=[example_id],
            include=["metadatas", "documents"]
        )
        ids = result.get("ids", [])
        if not ids:
            return None
        meta = result["metadatas"][0] if result.get("metadatas") else {}
        text = result["documents"][0] if result.get("documents") else ""
        return {
            "id": ids[0],
            "filename": meta.get("filename"),
            "timestamp": meta.get("timestamp", ""),
            "archive_path": meta.get("archive_path"),
            "asa_code": meta.get("asa_code"),
            "hierarchy": meta.get("hierarchy"),
            "text_preview": text[:200] if text else "",
        }

    def search_codes(self, query: str) -> list:
        """Search ASA codes by code number, hierarchy, or description."""
        q = query.lower().strip()
        results = []
        for code, meta in self.code_to_meta.items():
            if (q in code.lower()
                    or q in meta.get("hierarchy", "").lower()
                    or q in meta.get("description", "").lower()
                    or q in meta.get("disposal_action", "").lower()):
                results.append({
                    "asa_code": code,
                    "hierarchy": meta.get("hierarchy", ""),
                    "description": meta.get("description", ""),
                    "disposal_action": meta.get("disposal_action", ""),
                })
        return sorted(results, key=lambda x: x["asa_code"])

    def export_examples(self) -> list:
        """
        Export all training examples as a list of plain dicts (no vectors).
        Safe to serialise as JSON and import on another system.
        """
        result = self.db_examples._collection.get(include=["metadatas", "documents"])
        ids = result.get("ids", [])
        documents = result.get("documents", [])
        metadatas = result.get("metadatas", [])
        return [
            {"id": doc_id, "text": text, "metadata": meta}
            for doc_id, text, meta in zip(ids, documents, metadatas)
        ]

    def import_examples(self, examples: list) -> dict:
        """
        Import training examples from a list of dicts produced by export_examples().
        Re-embeds each example using the current model.

        Skips duplicates by:
        - Original ID match (fast path — same export/import cycle)
        - Content hash match (catches entries where the ID changed but content is identical,
          e.g. imported from a different system that used different ID generation)

        Returns counts of imported and skipped records.
        """
        imported = 0
        skipped = 0
        for entry in examples:
            doc_id = entry.get("id")
            text = entry.get("text", "")
            meta = entry.get("metadata", {})
            if not doc_id or not text:
                skipped += 1
                continue

            # Check by original ID
            existing = self.db_examples.get(ids=[doc_id])
            if existing and len(existing["ids"]) > 0:
                skipped += 1
                continue

            # Check by content hash (stable across systems)
            embed_text = clean_for_embedding(text)
            content_hash = self._generate_text_hash(embed_text)
            if content_hash != doc_id:
                existing_by_hash = self.db_examples.get(ids=[content_hash])
                if existing_by_hash and len(existing_by_hash["ids"]) > 0:
                    skipped += 1
                    continue

            doc = Document(page_content=embed_text, metadata=meta)
            self.db_examples.add_documents([doc], ids=[doc_id])
            imported += 1
        return {"imported": imported, "skipped": skipped}

    def suggest(self, description: str) -> list:
        """Returns top 3 ASA code suggestions for a plain-text description."""
        query = clean_for_embedding(description)
        rules_results = self.db_rules.similarity_search(query, k=5)
        example_results = self.db_examples.similarity_search(query, k=3)

        context_text = "OFFICIAL ASA RULES:\n"
        for res in rules_results:
            context_text += f"- Code {res.metadata.get('asa_code')}: {res.page_content}\n"

        if example_results:
            context_text += "\nSIMILAR PREVIOUSLY CLASSIFIED DOCUMENTS:\n"
            for res in example_results:
                context_text += f"- Previously classified as {res.metadata.get('asa_code')} ({res.metadata.get('hierarchy')})\n"

        assignable_hint = self._assignable_codes_hint(rules_results)

        prompt = f"""
        {context_text}
        {assignable_hint}
        DOCUMENT DESCRIPTION PROVIDED BY USER:
        {description}

        Task: Based on the rules and examples above, suggest the top 3 most likely ASA codes for a document matching this description.
        IMPORTANT: You MUST only suggest codes from the VALID ASSIGNABLE CODES list above. Do not invent codes. Do not suggest parent or category codes — only leaf-level codes that have a specific disposal action.
        Return ONLY a JSON object with a 'suggestions' array. Each item must have:
        - 'asa_code': the numeric code only, e.g. "2.1.3" (NOT the title or hierarchy text)
        - 'hierarchy': the full classification path, e.g. "Function > Class > Subclass"
        - 'confidence': a float between 0 and 1
        - 'reasoning': one sentence explaining why this code applies
        """

        response = self.client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            extra_body={"options": {"num_ctx": config.LLM_NUM_CTX}},
        )
        result = self._parse_json(response.choices[0].message.content)
        suggestions = result.get("suggestions", [])

        # Enrich each suggestion with authoritative metadata from the code list
        for s in suggestions:
            meta = self.code_to_meta.get(s.get("asa_code"), {})
            s["description"] = meta.get("description", "")
            s["examples"] = meta.get("examples", "")
            s["disposal_action"] = meta.get("disposal_action", "")
            # Use official hierarchy if available, fall back to LLM's value
            if meta.get("hierarchy"):
                s["hierarchy"] = meta["hierarchy"]

        # Remove hallucinated or non-assignable (parent) codes
        return self._filter_valid_suggestions(suggestions)

    def _assignable_codes_hint(self, rules_results) -> str:
        """
        Build a prompt hint listing only assignable (leaf-level) codes from the RAG
        context — i.e. codes that exist in code_to_meta AND have a disposal_action.
        This constrains the LLM to codes that can actually be assigned to a document.
        """
        lines = []
        for res in rules_results:
            code = res.metadata.get("asa_code")
            if not code:
                continue
            meta = self.code_to_meta.get(code, {})
            if meta.get("disposal_action"):
                lines.append(
                    f"  - {code} | {meta.get('hierarchy', '')} | Disposal: {meta['disposal_action']}"
                )
        if not lines:
            return ""
        return (
            "\nVALID ASSIGNABLE CODES (from the rules above — only these may be suggested):\n"
            + "\n".join(lines)
            + "\n"
        )

    def _filter_valid_suggestions(self, suggestions: list) -> list:
        """
        Remove any suggestion whose code does not exist in the knowledge base or
        has no disposal action (i.e. is a parent/category node, not assignable).
        """
        valid = []
        for s in suggestions:
            code = s.get("asa_code")
            meta = self.code_to_meta.get(code, {})
            if meta.get("disposal_action"):
                valid.append(s)
            elif config.DEBUG_MODE:
                reason = "not in KB" if not meta else "no disposal action (parent code)"
                print(f"[DEBUG] Filtered suggestion {code!r}: {reason}")
        return valid

    def delete_example(self, example_id: str):
        """
        Deletes a single example from the examples store by ID.
        """
        self.db_examples.delete(ids=[example_id])

    def rebuild_embeddings(self, progress_callback=None):
        """
        Rebuilds both vector store collections from scratch using the current
        embedding model and clean_for_embedding preprocessing.

        - asa_rules: re-ingested from asa_classification_kb.json
        - asa_examples: existing training docs re-embedded with cleaned text

        progress_callback(message: str) is called with status updates if provided.
        """
        def log(msg):
            print(f"[Rebuild] {msg}")
            if progress_callback:
                progress_callback(msg)

        # ── 1. Rebuild rules collection ──────────────────────────────────────
        codes_path = "asa_codes_full_list.json"
        if not os.path.exists(codes_path):
            raise FileNotFoundError(f"Code list not found: {codes_path}")

        with open(codes_path, 'r') as f:
            codes_data = json.load(f)

        log(f"Rebuilding rules collection from {len(codes_data)} ASA codes...")

        try:
            self.db_rules._client.delete_collection("asa_rules")
        except Exception:
            pass
        self.db_rules = Chroma(
            collection_name="asa_rules",
            persist_directory=config.VECTOR_DB_PATH,
            embedding_function=self.embeddings
        )

        rule_docs = []
        for asa_code, meta in codes_data.items():
            raw = (
                f"Code: {asa_code}\n"
                f"Hierarchy: {meta.get('hierarchy', '')}\n"
                f"Description: {meta.get('description', '')}\n"
                f"Examples: {meta.get('examples', '')}"
            )
            rule_docs.append(Document(
                page_content=clean_for_embedding(raw),
                metadata={
                    "asa_code": asa_code,
                    "hierarchy": meta.get("hierarchy", ""),
                    "disposal": meta.get("disposal_action", ""),
                }
            ))

        # Ingest in batches to avoid memory spikes
        batch_size = 50
        for i in range(0, len(rule_docs), batch_size):
            batch = rule_docs[i:i + batch_size]
            self.db_rules.add_documents(batch)
            log(f"Rules: {min(i + batch_size, len(rule_docs))}/{len(rule_docs)}")

        log(f"Rules collection rebuilt ({len(rule_docs)} documents).")

        # ── 2. Re-embed training examples ────────────────────────────────────
        existing = self.db_examples._collection.get(include=["metadatas", "documents"])
        ids = existing.get("ids", [])
        metadatas = existing.get("metadatas", [])
        documents = existing.get("documents", [])

        log(f"Re-embedding {len(ids)} training examples...")

        if ids:
            try:
                self.db_examples._client.delete_collection("asa_examples")
            except Exception:
                pass
            self.db_examples = Chroma(
                collection_name="asa_examples",
                persist_directory=config.VECTOR_DB_PATH,
                embedding_function=self.embeddings
            )

            for i, (doc_id, raw_text, meta) in enumerate(zip(ids, documents, metadatas)):
                cleaned = clean_for_embedding(raw_text)
                doc = Document(page_content=cleaned, metadata=meta)
                self.db_examples.add_documents([doc], ids=[doc_id])
                if (i + 1) % 10 == 0 or (i + 1) == len(ids):
                    log(f"Examples: {i + 1}/{len(ids)}")

        log("Rebuild complete.")

    def analyse_image(self, file_path: str) -> dict:
        """
        Uses the vision model to determine if an image is a scanned/photographed
        document or a photograph, then extracts text or describes the scene.
        Returns: {'is_photo': bool, 'content': str}
        """
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}
        ext = os.path.splitext(file_path)[1].lower()
        mime = mime_map.get(ext, 'image/jpeg')

        with open(file_path, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode()

        prompt = """Analyse this image carefully.

Determine whether this is:
(A) A scanned or photographed document containing text (letter, invoice, form, certificate, report, or any paper with written or printed text), OR
(B) A photograph of people, places, events, objects, or activities (not primarily a text document)

If (A) document: Extract and transcribe all visible text as accurately as possible.
If (B) photograph: Provide a detailed description of what the photograph shows — people, setting, activity, occasion, and any other relevant context.

Return ONLY a JSON object: {"type": "document" or "photo", "content": "extracted text or detailed description"}"""

        response = self.vision_client.chat.completions.create(
            model=config.VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
                ]
            }],
            extra_body={"options": {"num_ctx": config.LLM_NUM_CTX}},
        )

        result = self._parse_json(response.choices[0].message.content)
        return {
            "is_photo": result.get("type") == "photo",
            "content": result.get("content", "")
        }

    def classify(self, ocr_text: str, is_photo: bool = False):
        if config.DEBUG_MODE:
            print(f"[DEBUG] Starting classification process...")

        # 1. Clean text for embedding
        embed_text = clean_for_embedding(ocr_text)
        if config.DEBUG_MODE:
            print(f"[DEBUG] Embedding {len(embed_text)} chars (from {len(ocr_text)} raw) for retrieval.")

        # 2. Retrieve the 5 most relevant official RULES
        rules_results = self.db_rules.similarity_search(embed_text, k=5)
        if config.DEBUG_MODE:
            print(f"[DEBUG] RAG (Rules) matches: {[r.metadata.get('asa_code') for r in rules_results]}")

        # 3. Retrieve the 3 most similar PREVIOUSLY CLASSIFIED documents
        example_results = self.db_examples.similarity_search(embed_text, k=3)
        if config.DEBUG_MODE:
            print(f"[DEBUG] RAG (Examples) matches: {[r.metadata.get('asa_code') for r in example_results]}")

        # 4. Format Context
        context_text = "OFFICIAL ASA RULES:\n"
        for res in rules_results:
            context_text += f"- {res.page_content}\n"

        if example_results:
            context_text += "\nSIMILAR PREVIOUSLY CLASSIFIED EXAMPLES:\n"
            for res in example_results:
                context_text += f"- Previously classified as {res.metadata.get('asa_code')} ({res.metadata.get('hierarchy')})\n"

        # 5. Final classification via LLM
        photo_hint = (
            "\nNOTE: This content was derived from a photograph, not a text document. "
            "Prioritise ASA codes relating to photographs, visual records, events, people, and facilities.\n"
        ) if is_photo else ""

        assignable_hint = self._assignable_codes_hint(rules_results)

        prompt = f"""
        {context_text}
        {photo_hint}{assignable_hint}
        NEW DOCUMENT TO CLASSIFY:
        {ocr_text}

        Task: Based on the rules and similar historical examples, return the top 3 most likely ASA classifications for this document, ranked by confidence.
        IMPORTANT: You MUST only suggest codes from the VALID ASSIGNABLE CODES list above. Do not invent codes. Do not suggest parent or category codes — only leaf-level codes that have a specific disposal action.
        Return ONLY a JSON object with:
        - 'suggested_title': a concise, descriptive title for this specific document (e.g. "Staff Meeting Minutes — 12 March 2024", "Invoice — ABC Supplies Pty Ltd", "Annual Report 2023–24"). Be specific using names, dates, or other distinguishing details visible in the document.
        - 'suggestions' array, where each item has:
          - 'asa_code': the numeric code only, e.g. "2.1.3" (NOT the title or hierarchy text)
          - 'hierarchy': the full classification path, e.g. "Function > Class > Subclass"
          - 'reasoning': one or two sentences explaining why this code applies
          - 'confidence': a float between 0 and 1
        """

        if config.DEBUG_MODE:
            print(f"[DEBUG] Sending request to LLM ({config.LLM_MODEL})...")

        response = self.client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            extra_body={"options": {"num_ctx": config.LLM_NUM_CTX}},
        )

        result_json = self._parse_json(response.choices[0].message.content)
        suggestions = result_json.get("suggestions", [])
        suggested_title = result_json.get("suggested_title", "")

        # Enrich each suggestion with authoritative metadata
        for s in suggestions:
            meta = self.code_to_meta.get(s.get("asa_code"), {})
            if meta.get("hierarchy"):
                s["hierarchy"] = meta["hierarchy"]
            s["description"] = meta.get("description", "")
            s["examples"] = meta.get("examples", "")
            s["disposal_action"] = meta.get("disposal_action", "")

        # Remove hallucinated or non-assignable (parent) codes
        suggestions = self._filter_valid_suggestions(suggestions)

        if config.DEBUG_MODE:
            print(f"[DEBUG] Suggested title: {suggested_title!r}")
            for s in suggestions:
                print(f"[DEBUG] Suggestion: {s.get('asa_code')} ({s.get('confidence', 0)*100:.0f}%) — {s.get('reasoning')}")

        return {"suggestions": suggestions, "suggested_title": suggested_title}
