# ASA School Document Classifier

An enterprise-grade, privacy-first classification engine for school archives. Automatically categorises documents according to the **Australian Society of Archivists (ASA)** Records Retention & Disposal Schedule (RRDS).

---

## 🏗 System Architecture

The system uses a **Hierarchical RAG (Retrieval-Augmented Generation)** architecture backed by a React web UI and a FastAPI backend.

### Classification Logic

- **Contextual Search:** Semantic search against the full ASA hierarchy (including parent descriptions such as `1.8 Agreements`).
- **Strict Assignment:** Only **leaf codes** with an explicit disposal action (e.g. `1.8.1`) can be assigned. Parent codes provide context only.
- **Knowledge Base:** 157 valid leaf codes, each enriched with hierarchy and parent descriptions.

### Processing Pipeline

1. **Ingestion:** Files arrive via folder watcher (`docs/input/`) or REST API.
2. **Content Extraction (Three-tier):**
   - **Direct:** Embedded text layer (PDF), plain text, DOCX paragraphs, Excel sheets.
   - **Tier 1 OCR (Tesseract):** Local, fast — handles clean printed text.
   - **Tier 2 OCR (PaddleOCR):** Remote microservice — handles handwriting and complex layouts.
3. **Vision Analysis:** Optional vision model determines whether an image/PDF is a photograph or a document. Photos are described by the model rather than OCR'd.
4. **RAG Retrieval:** Top 5 ASA rule matches + top 3 trained example matches via ChromaDB.
5. **LLM Reasoning:** Synthesises OCR text, rules, and examples into a ranked list of up to 3 classifications with confidence scores and reasoning.
6. **Output:** Results written to `docs/processed/{filename}/classification.json`.

---

## 🧠 Continual Learning

The system improves over time through two mechanisms:

1. **Auto-Learn:** Documents classified with **≥90% confidence** are automatically added to the examples vector store.
2. **Human Confirmation:** Users confirm or correct a classification via the verification UI or `/api/jobs/{job_id}/confirm`. Confirmed examples are stored with SHA-256 deduplication and near-duplicate suppression (cosine similarity ≥ 0.97).

---

## 🚀 Getting Started

### Prerequisites

- [Docker Compose](https://docs.docker.com/compose/install/)
- An LLM provider (OpenAI API key, Azure OpenAI, LM Studio, or local Ollama)

### Installation

1. Copy the example environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```
2. Start all services:
   ```bash
   docker compose up --build -d
   ```
3. Open `http://localhost:8000` in your browser.

### Services

| Service | Port | Description |
|---|---|---|
| `asa-classifier` | 8000 | FastAPI backend + React frontend |
| `paddleocr-service` | 8080 (internal) | PaddleOCR microservice for advanced OCR |
| `ollama` | 11434 | Optional local LLM (enable with `--profile ollama`) |

---

## ⚙️ Configuration

All settings are controlled via environment variables in `.env`.

### LLM Provider

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_BASE` | API base URL (see providers below) | `https://api.openai.com/v1` |
| `OPENAI_API_KEY` | API key | — |
| `LLM_MODEL` | Model or deployment name | `gpt-4o` |
| `OPENAI_API_VERSION` | **Azure OpenAI only** — API version (e.g. `2024-02-01`); leave blank for all other providers | — |

**Provider examples:**

```bash
# OpenAI
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Azure OpenAI
OPENAI_API_BASE=https://<resource>.openai.azure.com
OPENAI_API_KEY=<your-key>
LLM_MODEL=<deployment-name>
OPENAI_API_VERSION=2024-02-01

# LM Studio (local)
OPENAI_API_BASE=http://localhost:1234/v1
OPENAI_API_KEY=lm-studio
LLM_MODEL=<model-name>

# Ollama (local, use --profile ollama)
OPENAI_API_BASE=http://ollama:11434/v1
OPENAI_API_KEY=ollama
LLM_MODEL=llama3
```

### Vision Model

| Variable | Description | Default |
|---|---|---|
| `VISION_MODEL` | Vision-capable model name | `llama3.2-vision:11b` |
| `VISION_ENABLED` | Enable/disable vision analysis | `true` |

When `VISION_ENABLED=true`, the same provider and API key are used for vision. Set `VISION_MODEL` to a vision-capable model for your chosen provider (e.g. `gpt-4o` for OpenAI).

### Other Settings

| Variable | Description | Default |
|---|---|---|
| `REMOTE_OCR_URL` | PaddleOCR service URL (auto-set in Docker) | — |
| `LLM_NUM_CTX` | Context window size (Ollama only) | `8192` |
| `ADMIN_USERNAME` | HTTP Basic Auth username for admin endpoints | — |
| `ADMIN_PASSWORD` | HTTP Basic Auth password for admin endpoints | — |
| `ALLOW_USER_TRAINING` | Show "Train with this result" in the UI | `true` |
| `DEBUG_MODE` | Verbose OCR, RAG, and LLM logging | `false` |

---

## 📂 Usage

### Web UI

- **`/`** — Upload documents, view classification results, confirm or correct.
- **`/admin/`** — Manage training examples, rebuild embeddings, import/export data.
- **`/verify/{job_id}`** — Human-in-the-loop verification for a specific job.

### Folder Watcher

Drop files into `./docs/input/`. Supported formats: `.pdf`, `.jpg`, `.jpeg`, `.png`, `.txt`, `.docx`, `.xlsx`, `.xls`.

Results are written to `./docs/processed/{filename}/classification.json`.

### Bulk Training (Bootstrap)

Prime the system with known-good examples by placing files under `docs/training/`:

```
docs/training/{ASA_CODE}/document.pdf
docs/training/4.2.2/enrollment_form_2023.pdf
```

Files are OCR'd, added to the examples store under the given code, then deleted. The folder is preserved.

---

## 🔌 REST API

### Classification

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Queue file for async background processing |
| `POST` | `/api/analyse` | Synchronous classification — returns results immediately |
| `POST` | `/api/suggest` | Get top 3 code suggestions for a plain-text description |

#### `/api/analyse` parameters

| Field | Type | Default | Description |
|---|---|---|---|
| `file` | file | required | Document to classify |
| `student_specific` | bool | `false` | When `true`, instructs the LLM to strongly prefer individual-student ASA codes (3.2.1, 3.4.x, all 4.x, and the individual-student sub-codes within 5.x) over school-wide or program-level codes |

The same `student_specific` field is also accepted by `/api/jobs/submit`.

### Verification Workflow (Jobs)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/jobs/submit` | Submit a document with optional verification and webhook config |
| `GET` | `/api/jobs/{job_id}` | Get job status and classification results |
| `GET` | `/api/jobs/{job_id}/document` | Retrieve the stored document for preview |
| `POST` | `/api/jobs/{job_id}/confirm` | Confirm classification, fire webhook, optionally train |

`/api/jobs/submit` supports:
- `verify=true` — store the document and return a `verify_url` for human review.
- `verify=false` — auto-confirm immediately and fire the webhook.
- `auto_confirm_threshold` — skip verification if top confidence ≥ threshold.

### Training

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/train` | Train on a single document with a known ASA code |
| `POST` | `/api/train/bulk` | Bulk training (admin only) |
| `GET` | `/api/training/codes` | List all codes with example counts (admin only) |
| `GET` | `/api/training/codes/{code}/examples` | List examples for a code (admin only) |
| `DELETE` | `/api/training/examples/{example_id}` | Delete a training example (admin only) |

### Admin

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/admin/rebuild-embeddings` | Rebuild vector stores from scratch |
| `GET` | `/api/admin/rebuild-status` | Embedding rebuild progress |
| `GET` | `/api/admin/export-examples` | Export all training examples as JSON |
| `POST` | `/api/admin/import-examples` | Import training examples from JSON |
| `GET` | `/api/admin/webhook-templates` | List webhook templates |
| `PUT` | `/api/admin/webhook-templates/{name}` | Create or update a custom template |
| `DELETE` | `/api/admin/webhook-templates/{name}` | Delete a custom template |

### Other

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/settings` | Public settings (auth status, feature flags) |
| `GET` | `/api/asa-codes` | List or search ASA codes |

---

## 📄 Output Format

`/api/analyse` response (synchronous):

```json
{
  "suggested_title": "Staff Meeting Minutes — 12 March 2024",
  "suggestions": [
    {
      "asa_code": "4.8.1",
      "hierarchy": "STUDENT MANAGEMENT > BEHAVIOUR > SIGNIFICANT EVENTS",
      "description": "Student behaviour records...",
      "disposal_action": "Retain permanently",
      "reasoning": "Document describes a formal expulsion hearing.",
      "confidence": 0.91
    },
    {
      "asa_code": "2.1.3",
      "hierarchy": "GOVERNANCE > STRATEGIC PLANNING > ANNUAL REPORTS",
      "disposal_action": "Retain for 7 years",
      "reasoning": "Contains meeting minutes format.",
      "confidence": 0.73
    }
  ],
  "filename": "meeting_minutes.pdf",
  "is_photo": false,
  "student_specific": false,
  "vision_description": null,
  "llm_model": "gpt-4o",
  "processing_time_seconds": 3.45
}
```

Folder-watcher output is saved as `docs/processed/{filename}/classification.json` with the same structure (minus the timing fields).

---

## 🔗 Therefore DMS Integration

Two built-in Jinja2 webhook templates are provided for Therefore DMS:

- **`therefore_save_index_quick`** — Writes ASA classification to index fields using `SaveDocumentIndexDataQuick`. No concurrency token required.
- **`therefore_update_index`** — Uses `UpdateDocumentIndex` with a `LastChangeTimeISO8601` concurrency token (requires a pre-fetch call to `GetDocumentIndexData`).

Custom templates can be managed via the admin UI or the `/api/admin/webhook-templates` endpoints. Templates are rendered with Jinja2 and support HMAC-SHA256 signing via `webhook_secret`.

---

## 🐛 Debugging

Set `DEBUG_MODE=true` to log:
- OCR text previews and the engine used
- RAG hits — which codes were retrieved and their similarity scores
- LLM reasoning — the full prompt context and model output
