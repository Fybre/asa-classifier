import os

# 1. Folders
INPUT_FOLDER = "docs/input"
PROCESSED_FOLDER = "docs/processed"
TRAINING_FOLDER = "docs/training"
TRAINING_ARCHIVE_FOLDER = "docs/training_archive"
ASA_KB_PATH = "asa_classification_kb.json"
VECTOR_DB_PATH = "asa_vector_db"

# 2. LLM Configuration
# Use "http://localhost:11434/v1" for local Ollama
# Use "https://api.openai.com/v1" for OpenAI
OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your-api-key-here")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o") # Or "llama3" if local

# 3. OCR Configuration
# If you run DocTR or PaddleOCR in a separate container, put the URL here
REMOTE_OCR_URL = os.getenv("REMOTE_OCR_URL", None)

# 4. Vision Model (for photo detection and image description)
VISION_MODEL = os.getenv("VISION_MODEL", "llama3.2-vision:11b")
VISION_ENABLED = os.getenv("VISION_ENABLED", "true").lower() == "true"

# 5. LLM Context Window
# 8192 handles most multi-page OCR text. Increase for very long documents.
LLM_NUM_CTX = int(os.getenv("LLM_NUM_CTX", "8192"))

# 6. Admin authentication
# Set both ADMIN_USERNAME and ADMIN_PASSWORD to enable HTTP Basic Auth on all
# admin and training-management endpoints. Leave either blank to disable auth.
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# 7. Feature flags
# Set to "false" to hide the "Train with this result" button on the classify page.
ALLOW_USER_TRAINING = os.getenv("ALLOW_USER_TRAINING", "true").lower() == "true"

# 5. Debugging
DEBUG_MODE = os.getenv("DEBUG_MODE", "true").lower() == "true"

TEMP_FOLDER = "docs/tmp"
JOBS_FOLDER = "docs/jobs"

# Webhook template storage (custom templates persist here; built-ins are always available)
WEBHOOK_TEMPLATES_FILE = os.path.join("asa_vector_db", "webhook_templates.json")

# Built-in Jinja2 webhook templates for Therefore DMS integration.
# Field names (ASACode, ASAHierarchy, DisposalAction) are the Therefore index
# field names for the target category — copy and customise as needed.
DEFAULT_WEBHOOK_TEMPLATES = {
    "therefore_save_index_quick": {
        "description": (
            "Therefore SaveDocumentIndexDataQuick — writes ASA classification back "
            "to a Therefore document's index fields. No concurrency token required."
        ),
        "body": (
            '{\n'
            '  "DocNo": {{ doc_no }},\n'
            '  "CheckInComments": "ASA Classification — {{ filename }}",\n'
            '  "IndexData": {\n'
            '    "IndexDataItems": [\n'
            '      {"StringIndexData": {"FieldName": "{{ asa_code_field   | default(\'ASACode\')        }}", "FieldNo": 0, "DataValue": "{{ confirmed_code }}"}},\n'
            '      {"StringIndexData": {"FieldName": "{{ hierarchy_field  | default(\'ASAHierarchy\')   }}", "FieldNo": 0, "DataValue": "{{ confirmed_hierarchy }}"}},\n'
            '      {"StringIndexData": {"FieldName": "{{ disposal_field   | default(\'DisposalAction\') }}", "FieldNo": 0, "DataValue": "{{ confirmed_disposal }}"}}\n'
            '    ],\n'
            '    "DoFillDependentFields": true\n'
            '  }\n'
            '}'
        ),
    },
    "therefore_update_index": {
        "description": (
            "Therefore UpdateDocumentIndex — writes ASA classification with a "
            "LastChangeTimeISO8601 concurrency token. Requires a pre-fetch call "
            "to GetDocumentIndexData to retrieve the token first."
        ),
        "body": (
            '{\n'
            '  "DocNo": {{ doc_no }},\n'
            '  "CheckInComments": "ASA Classification — {{ filename }}",\n'
            '  "IndexData": {\n'
            '    "IndexDataItems": [\n'
            '      {"StringIndexData": {"FieldName": "{{ asa_code_field   | default(\'ASACode\')        }}", "FieldNo": 0, "DataValue": "{{ confirmed_code }}"}},\n'
            '      {"StringIndexData": {"FieldName": "{{ hierarchy_field  | default(\'ASAHierarchy\')   }}", "FieldNo": 0, "DataValue": "{{ confirmed_hierarchy }}"}},\n'
            '      {"StringIndexData": {"FieldName": "{{ disposal_field   | default(\'DisposalAction\') }}", "FieldNo": 0, "DataValue": "{{ confirmed_disposal }}"}}\n'
            '    ],\n'
            '    "LastChangeTimeISO8601": "{{ fetched.IndexData.LastChangeTimeISO8601 | default(\'\') }}",\n'
            '    "DoFillDependentFields": true\n'
            '  }\n'
            '}'
        ),
    },
}

# Ensure folders exist
os.makedirs(INPUT_FOLDER, exist_ok=True)
os.makedirs(PROCESSED_FOLDER, exist_ok=True)
os.makedirs(TRAINING_ARCHIVE_FOLDER, exist_ok=True)
os.makedirs(TEMP_FOLDER, exist_ok=True)
os.makedirs(JOBS_FOLDER, exist_ok=True)
