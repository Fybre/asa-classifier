# ASA School Document Classifier

An enterprise-grade, privacy-first classification engine for school archives. This system automatically categorizes documents according to the **Australian Society of Archivists (ASA)** Records Retention & Disposal Schedule (RRDS).

## 🏗 System Architecture

The system uses a **Hierarchical RAG (Retrieval-Augmented Generation)** architecture to ensure that documents are classified with high semantic accuracy while adhering to strict archival rules.

### 1. The Classification Logic (Hierarchical RAG)
The system distinguishes between **Descriptive Codes** (high-level categories) and **Actionable Codes** (valid for assignment).
*   **Contextual Search:** When a document is scanned, the system performs a semantic search against the entire ASA hierarchy (including parent descriptions like `1.8 Agreements`).
*   **Strict Assignment:** The system is constrained to only assign **Leaf Codes** that have an explicit disposal action (e.g., `1.8.1`). It uses the parent context to understand the "vibe" of the document but will never assign a parent-level code.
*   **Knowledge Base:** Powered by a consolidated index of 157 valid leaf codes enriched with their parental descriptions.

### 2. The Processing Pipeline
1.  **Ingestion:** Files are picked up via a **Folder Watcher** (`docs/input`) or a **REST API**.
2.  **Dual-Tier OCR:** 
    *   **Tier 1 (Fast):** Tesseract handles clean, printed text locally.
    *   **Tier 2 (Advanced):** If handwriting is detected or Tier 1 fails, the system calls a dedicated **PaddleOCR** microservice.
3.  **RAG Retrieval:** The system retrieves the 3 most relevant ASA rules and the 2 most similar historical "Gold Standard" examples.
4.  **LLM Reasoning:** An LLM (OpenAI or local Ollama) synthesizes the OCR text, the rules, and the examples to provide a final JSON classification with reasoning.
5.  **Export:** Results are saved as a structured JSON sidecar file alongside the original PDF, ready for **Therefore DMS** ingestion.

---

## 🧠 Continual Learning (Feedback Loop)

The system gets smarter over time through two mechanisms:
1.  **Auto-Learn:** Documents classified with **>90% confidence** are automatically added to the "Examples" vector database.
2.  **Human Confirmation:** Users can "teach" the system by sending a confirmed code to the `/confirm` endpoint. The system automatically resolves the hierarchy and disposal rules for that code and saves the document's "conceptual signature" for future matches.

---

## 🚀 Getting Started

### Prerequisites
*   [Docker Compose](https://docs.docker.com/compose/install/)
*   OpenAI API Key (or local Ollama instance)

### Installation & Run
1.  **Configure:** Open `docker-compose.yml` and set your `OPENAI_API_KEY`.
2.  **Start:**
    ```bash
    docker compose up --build -d
    ```

---

## 📂 Usage & API

### Ingestion
*   **Automated:** Drop files into `./docs/input/`.
*   **API:** `POST http://localhost:8000/upload` (multipart/form-data `file`).

### Manual Confirmation (Teaching)
If the system misclassifies a document, send the correct **ASA Code** to the feedback loop:
*   **Endpoint:** `POST http://localhost:8000/confirm`
*   **Payload:**
    ```json
    {
        "asa_code": "4.2.2",
        "ocr_text": "Full extracted text from the document..."
    }
    ```

### Bulk Training Ingestion (Bootstrap)
You can "prime" the system with high-quality examples by dropping them into the training folder. The system uses the **folder name** as the ASA code.

*   **Structure:** `./docs/training/[ASA_CODE]/document.pdf`
*   **Example:** `./docs/training/4.2.2/enrollment_form_2023.pdf`
*   **Process:**
    1.  The system detects the new file in the subfolder.
    2.  Extracts text via OCR (Dual-tier).
    3.  Adds the result to the learning database as a confirmed example for code `4.2.2`.
    4.  **Cleanup:** The file is **deleted** after ingestion to keep the folder clean (the parent folder is preserved).
    5.  **De-duplication:** If the same document text is ingested twice, it is automatically skipped via SHA-256 hashing.

### Debugging & Troubleshooting
Enable `DEBUG_MODE=true` in `docker-compose.yml` to see the following in your logs:
*   **OCR Results:** Previews of extracted text and the engine used.
*   **RAG Hits:** Which ASA codes were considered during the search.
*   **AI Reasoning:** The step-by-step logic used by the LLM to pick the code.

---

## 📁 Output Format
Each processed file generates a folder in `docs/processed/` containing:
1.  **Original Document:** (PDF/Image)
2.  **`classification.json`**:
    ```json
    {
        "asa_code": "4.8.1",
        "hierarchy": "STUDENT MANAGEMENT > BEHAVIOUR > SIGNIFICANT EVENTS",
        "disposal_rule": "Retain permanently",
        "reasoning": "Document mentions a formal expulsion hearing and court correspondence.",
        "confidence": 0.98
    }
    ```
