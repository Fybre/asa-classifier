import { useState } from 'react'
import { Link } from 'react-router-dom'

const SECTIONS = ['User Guide', 'API Reference']

// ── Shared components ─────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="text-slate-400 text-sm leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

function Note({ children }) {
  return (
    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-4 py-3 text-indigo-300 text-sm">
      {children}
    </div>
  )
}

function GroupHeading({ children }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{children}</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  )
}

function ApiBlock({ method, path, description, body, contentType, response, example }) {
  const [tab, setTab] = useState('docs')
  const methodColour =
    method === 'GET' ? 'text-emerald-400' :
    method === 'POST' ? 'text-indigo-400' :
    'text-red-400'
  const bodyLabel = contentType === 'json'
    ? 'Request body (application/json)'
    : 'Request body (multipart/form-data)'

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      {/* Method + path */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className={`font-mono font-bold text-sm ${methodColour}`}>{method}</span>
          <span className="font-mono text-slate-300 text-sm">{path}</span>
        </div>
        {example && (
          <div className="flex gap-1">
            {['docs', 'example'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  tab === t ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t === 'docs' ? 'Reference' : 'curl'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {tab === 'docs' ? (
          <>
            <p className="text-slate-400 text-sm">{description}</p>
            {body && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">{bodyLabel}</p>
                <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">{body}</pre>
              </div>
            )}
            {response && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Response (JSON)</p>
                <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{response}</pre>
              </div>
            )}
          </>
        ) : (
          <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{example}</pre>
        )}
      </div>
    </div>
  )
}

// ── User Guide ────────────────────────────────────────────────────────────────

function UserGuide() {
  return (
    <div className="space-y-8">
      <Section title="Search Codes">
        <p>Browse the full ASA retention schedule or search by keyword, code number, or title.</p>
        <p>Results are split into two groups: exact phrase matches appear first, followed by results where all individual words are present. Matched terms are highlighted in the results.</p>
      </Section>

      <Section title="Describe Document">
        <p>Type a plain-language description of a document and the system will suggest the most likely ASA codes.</p>
        <p>You don't need to upload anything — just describe what the document is about. Press <kbd className="bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 text-xs font-mono">Enter</kbd> to submit, or <kbd className="bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 text-xs font-mono">Shift+Enter</kbd> for a new line.</p>
        <p>Up to three suggestions are returned, each with a confidence score and the reasoning behind the suggestion.</p>
      </Section>

      <Section title="Classify Document">
        <p>Upload a file to have it automatically classified. The system extracts text using OCR and matches it against the ASA schedule using a language model.</p>
        <p>Supported formats: PDF, Word (.docx), Excel (.xlsx, .xls), images (.jpg, .png), and plain text (.txt).</p>
        <p>For scanned images and photos, a vision model is used. If a photograph is detected (rather than a document scan), classification is weighted toward photo-relevant ASA codes.</p>
        <Note>Once a document has been classified, you can use the <strong>Train with this result</strong> button to save it as a training example. This improves future classifications for similar documents.</Note>
      </Section>

      <Section title="Confidence Scores">
        <p>Every classification comes with a confidence score:</p>
        <ul className="space-y-1 mt-2">
          <li className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" /> <span><strong className="text-slate-300">80–100%</strong> — high confidence, reliable result</span></li>
          <li className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0" /> <span><strong className="text-slate-300">50–79%</strong> — moderate confidence, review recommended</span></li>
          <li className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0" /> <span><strong className="text-slate-300">Below 50%</strong> — low confidence, manual classification advised</span></li>
        </ul>
      </Section>

      <Section title="Training">
        <p>The system improves over time through training examples. When you confirm a classification by clicking <strong className="text-slate-300">Train with this result</strong>, the document text is stored alongside its ASA code and used to improve future classifications via retrieval-augmented generation (RAG).</p>
        <p>Training examples can be reviewed and removed from the admin dashboard.</p>
      </Section>
    </div>
  )
}

// ── API Reference ─────────────────────────────────────────────────────────────

function ApiReference() {
  return (
    <div className="space-y-5">
      <Note>
        All endpoints return JSON. File uploads use <code className="text-indigo-300 font-mono text-xs">multipart/form-data</code>.
        Admin and training endpoints require HTTP Basic Auth when <code className="text-indigo-300 font-mono text-xs">ADMIN_USERNAME</code> is configured.
      </Note>

      {/* ── Classification ── */}
      <GroupHeading>Classification</GroupHeading>

      <ApiBlock
        method="POST"
        path="/api/analyse"
        description="Upload a document and receive a synchronous classification result. The top suggestion is returned alongside up to two alternatives. Supports PDF, DOCX, XLSX, XLS, JPG, PNG, TXT."
        body={`file  (file, required) — the document to classify`}
        response={`{
  "suggestions": [
    {
      "asa_code": "4.1.2",
      "hierarchy": "Student Records > Enrolment",
      "confidence": 0.87,
      "reasoning": "The document contains enrolment details...",
      "description": "Records relating to student enrolment.",
      "examples": "Enrolment forms, acceptance letters.",
      "disposal_action": "Destroy 7 years after student leaves."
    }
  ],
  "filename": "enrolment_form.pdf",
  "is_photo": false,
  "vision_description": null
}`}
        example={`curl -X POST http://localhost:8000/api/analyse \\
  -F "file=@enrolment_form.pdf"`}
      />

      <ApiBlock
        method="POST"
        path="/api/suggest"
        description="Provide a plain-text description of a document and receive up to three suggested ASA codes. No file upload needed."
        body={`description  (string, required) — plain-text description of the document`}
        response={`{
  "suggestions": [
    {
      "asa_code": "4.1.2",
      "hierarchy": "Student Records > Enrolment",
      "confidence": 0.91,
      "reasoning": "...",
      "description": "...",
      "examples": "...",
      "disposal_action": "..."
    }
  ]
}`}
        example={`curl -X POST http://localhost:8000/api/suggest \\
  -F "description=Student enrolment form signed by parent"`}
      />

      <ApiBlock
        method="GET"
        path="/api/asa-codes"
        description="Return all ASA codes with full metadata. Pass an optional query string to filter — exact phrase matches are returned first, followed by all-words matches."
        body={`q  (string, optional, query param) — search term`}
        response={`[
  {
    "asa_code": "4.1.2",
    "hierarchy": "Student Records > Enrolment",
    "description": "Records relating to student enrolment.",
    "examples": "Enrolment forms, acceptance letters.",
    "disposal_action": "Destroy 7 years after student leaves."
  }
]`}
        example={`# All codes
curl http://localhost:8000/api/asa-codes

# Filtered
curl "http://localhost:8000/api/asa-codes?q=enrolment"`}
      />

      {/* ── Verification workflow ── */}
      <GroupHeading>Document Submission &amp; Verification</GroupHeading>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-3">
        <p className="text-slate-300 font-medium">Verification workflow</p>
        <p>
          <code className="text-indigo-300 font-mono text-xs">POST /api/jobs/submit</code> is the integration entry point.
          It handles three scenarios:
        </p>
        <ol className="space-y-2 list-decimal list-inside">
          <li><strong className="text-slate-300">No verification</strong> — <code className="text-indigo-300 font-mono text-xs">verify=false</code> (default). Classifies immediately and returns the result. Webhook fires instantly if provided. No job is stored.</li>
          <li><strong className="text-slate-300">Auto-confirm</strong> — <code className="text-indigo-300 font-mono text-xs">verify=true</code> with <code className="text-indigo-300 font-mono text-xs">auto_confirm_threshold=90</code>. Goes to verification unless the top suggestion confidence is ≥ the threshold, in which case it behaves like scenario 1.</li>
          <li><strong className="text-slate-300">Human verification</strong> — <code className="text-indigo-300 font-mono text-xs">verify=true</code>. Stores the document, creates a job, and returns a <code className="text-indigo-300 font-mono text-xs">verify_url</code>. A human reviews the suggestions at that URL, selects a code, and confirms. On confirmation the webhook fires and the job and document are deleted.</li>
        </ol>
        <p>
          When a webhook is confirmed, the payload includes an <code className="text-indigo-300 font-mono text-xs">X-ASA-Signature: sha256=&lt;hmac&gt;</code> header computed using your <code className="text-indigo-300 font-mono text-xs">webhook_secret</code>, and an <code className="text-indigo-300 font-mono text-xs">X-ASA-Timestamp</code> header for replay protection.
        </p>
      </div>

      <ApiBlock
        method="POST"
        path="/api/jobs/submit"
        description="Submit a document for classification with optional human verification. See the workflow description above for the three scenarios."
        body={`file                     (file, required)
verify                   (bool, default false)       — require human verification
auto_confirm_threshold   (number 0–100, optional)    — skip verify if confidence ≥ value
webhook_url              (string, optional)           — URL to POST result to
webhook_headers          (JSON string, optional)      — extra headers for the webhook
webhook_secret           (string, optional)           — secret for HMAC signature
webhook_extra            (JSON string, optional)      — extra fields merged into webhook payload
metadata                 (JSON string, optional)      — arbitrary metadata stored with the job`}
        response={`// Scenario 1 & 2 — no verification needed:
{
  "suggestions": [...],
  "filename": "doc.pdf",
  "is_photo": false,
  "vision_description": null,
  "webhook_queued": true
}

// Scenario 3 — verification required:
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "verify_url": "/verify/550e8400-e29b-41d4-a716-446655440000",
  "suggestions": [...],
  "filename": "doc.pdf",
  "is_photo": false
}`}
        example={`# Immediate result, no verification
curl -X POST http://localhost:8000/api/jobs/submit \\
  -F "file=@document.pdf"

# Always verify — human reviews at verify_url
curl -X POST http://localhost:8000/api/jobs/submit \\
  -F "file=@document.pdf" \\
  -F "verify=true" \\
  -F "webhook_url=https://your-app.example.com/webhook" \\
  -F "webhook_secret=mysecret"

# Verify only when confidence is below 90 %
curl -X POST http://localhost:8000/api/jobs/submit \\
  -F "file=@document.pdf" \\
  -F "verify=true" \\
  -F "auto_confirm_threshold=90" \\
  -F "webhook_url=https://your-app.example.com/webhook" \\
  -F "webhook_secret=mysecret"

# Pass metadata and extra webhook fields
curl -X POST http://localhost:8000/api/jobs/submit \\
  -F "file=@document.pdf" \\
  -F "verify=true" \\
  -F 'metadata={"source_system":"therefore","doc_id":"12345"}' \\
  -F 'webhook_extra={"doc_id":"12345"}'`}
      />

      <ApiBlock
        method="GET"
        path="/api/jobs/{job_id}"
        description="Return the current state of a verification job, including suggestions and metadata. The verify page uses this to populate the review UI."
        response={`{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "file_ext": ".pdf",
  "status": "pending_verification",
  "suggestions": [
    {
      "asa_code": "4.1.2",
      "hierarchy": "Student Records > Enrolment",
      "confidence": 0.72,
      "reasoning": "...",
      "disposal_action": "Destroy 7 years after student leaves."
    }
  ],
  "metadata": { "is_photo": false },
  "created_at": "2025-06-01T14:32:00.000000+00:00"
}`}
        example={`curl http://localhost:8000/api/jobs/550e8400-e29b-41d4-a716-446655440000`}
      />

      <ApiBlock
        method="GET"
        path="/api/jobs/{job_id}/document"
        description="Serve the stored document for inline preview. Used by the verify page to display the file in an iframe or image tag. Returns the file with an appropriate Content-Type for browser rendering."
        example={`# Open in browser for inline preview
open http://localhost:8000/api/jobs/550e8400-.../document

# Download
curl -O http://localhost:8000/api/jobs/550e8400-.../document`}
      />

      <ApiBlock
        method="POST"
        path="/api/jobs/{job_id}/confirm"
        description="Confirm a classification for a pending verification job. The webhook fires and the job and document are deleted in the background. Set train=true to also add the document as a training example."
        contentType="json"
        body={`{
  "confirmed_code":      "4.1.2",           // required
  "confirmed_hierarchy": "Student Records > Enrolment",
  "confirmed_disposal":  "Destroy after 7 years",
  "train":               false,             // optional, default false
  "train_archive":       true               // optional, default true — archive the file
}`}
        response={`{ "status": "confirmed", "confirmed_code": "4.1.2" }`}
        example={`curl -X POST http://localhost:8000/api/jobs/550e8400-.../confirm \\
  -H "Content-Type: application/json" \\
  -d '{
    "confirmed_code": "4.1.2",
    "confirmed_hierarchy": "Student Records > Enrolment",
    "confirmed_disposal": "Destroy 7 years after student leaves.",
    "train": true
  }'`}
      />

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-2">
        <p className="text-slate-300 font-medium">Webhook payload</p>
        <p>Delivered via <code className="text-indigo-300 font-mono text-xs">POST</code> with <code className="text-indigo-300 font-mono text-xs">Content-Type: application/json</code>. Any fields from <code className="text-indigo-300 font-mono text-xs">webhook_extra</code> are merged into the top-level object.</p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{`{
  "event": "job.confirmed",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "confirmed_code": "4.1.2",
  "confirmed_hierarchy": "Student Records > Enrolment",
  "confirmed_disposal": "Destroy 7 years after student leaves.",
  "confirmed_at": "2025-06-01T14:35:12.483201+00:00",
  "metadata": { "source_system": "therefore", "doc_id": "12345" },
  "doc_id": "12345"   // from webhook_extra
}`}</pre>
        <p className="text-xs text-slate-500">Signature verification (Python example):</p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{`import hashlib, hmac

def verify_signature(body: bytes, secret: str, header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)`}</pre>
      </div>

      <ApiBlock
        method="POST"
        path="/api/upload"
        description="Upload a document for background processing via the folder watcher pipeline. The file is queued and classified asynchronously — no result is returned."
        body={`file  (file, required) — the document to process`}
        response={`{ "message": "File uploaded and added to processing queue.", "filename": "doc.pdf" }`}
        example={`curl -X POST http://localhost:8000/api/upload \\
  -F "file=@document.pdf"`}
      />

      {/* ── Therefore DMS integration ── */}
      <GroupHeading>Therefore DMS Integration</GroupHeading>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-3">
        <p className="text-slate-300 font-medium">How Therefore calls the classifier</p>
        <p>
          Therefore submits documents via <code className="text-indigo-300 font-mono text-xs">POST /api/jobs/submit</code> from a REST Call workflow task.
          The classifier processes the document and either returns the result immediately or stores it and returns a <code className="text-indigo-300 font-mono text-xs">verify_url</code>.
        </p>
        <p>
          When the user confirms the classification, the classifier calls back to a <strong className="text-slate-300">Therefore REST endpoint</strong>
          — not a generic webhook. The body must match the Therefore API structure and is rendered from a <strong className="text-slate-300">Jinja2 template</strong>.
          Two built-in templates are provided:
        </p>
        <ul className="space-y-1.5 list-disc list-inside">
          <li><code className="text-indigo-300 font-mono text-xs">therefore_save_index_quick</code> — calls <code className="text-slate-300 font-mono text-xs">SaveDocumentIndexDataQuick</code>. No concurrency token required. Recommended.</li>
          <li><code className="text-indigo-300 font-mono text-xs">therefore_update_index</code> — calls <code className="text-indigo-300 font-mono text-xs">UpdateDocumentIndex</code> with <code className="text-slate-300 font-mono text-xs">LastChangeTimeISO8601</code>. Requires a pre-fetch to <code className="text-slate-300 font-mono text-xs">GetDocumentIndexData</code>.</li>
        </ul>
        <p>
          The template field names (<code className="text-indigo-300 font-mono text-xs">ASACode</code>, <code className="text-indigo-300 font-mono text-xs">ASAHierarchy</code>, <code className="text-indigo-300 font-mono text-xs">DisposalAction</code>) must match
          the Therefore index field names for the target category. Override them via <code className="text-indigo-300 font-mono text-xs">webhook_extra_asa_code_field</code> etc.,
          or create a custom template.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300 space-y-2">
        <p className="font-medium">Therefore multipart quirks — read before configuring</p>
        <ul className="space-y-2 list-disc list-inside text-amber-200/80">
          <li>
            <strong className="text-amber-300">JSON mangling</strong> — Therefore's REST Call task corrupts JSON string values (braces, quotes get garbled).
            Never use <code className="font-mono text-xs">webhook_headers</code>, <code className="font-mono text-xs">webhook_extra</code>, or <code className="font-mono text-xs">webhook_pre_fetch_headers</code> as JSON objects from a Therefore workflow.
            Use the prefixed flat fields instead — one plain-text row per value:
            <code className="font-mono text-xs block mt-1 text-amber-300">webhook_header_Authorization, webhook_header_TenantName, webhook_extra_doc_no, webhook_pre_fetch_header_Authorization …</code>
          </li>
          <li>
            <strong className="text-amber-300">Metadata envelope</strong> — Therefore can optionally send all parameters inside a single <code className="font-mono text-xs">metadata</code> JSON part instead of individual fields. Direct form fields take precedence when both are present.
          </li>
          <li>
            <strong className="text-amber-300">Boolean fields</strong> — Therefore sends booleans as the string <code className="font-mono text-xs">"true"</code> or <code className="font-mono text-xs">"false"</code>. The endpoint also accepts <code className="font-mono text-xs">"1"</code> / <code className="font-mono text-xs">"yes"</code>.
          </li>
        </ul>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-3">
        <p className="text-slate-300 font-medium">Therefore REST Call — SaveDocumentIndexDataQuick (recommended)</p>
        <p>Add a REST Call task in the Therefore workflow designer with these body fields (table format):</p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{`URL:  POST http://asa-classifier:8000/api/jobs/submit
Auth: None

Field name                        Value
──────────────────────────────    ───────────────────────────────────────────────────────
file                              %Document%
verify                            true
auto_confirm_threshold            90                          (optional — skip verify if ≥ 90%)
webhook_template                  therefore_save_index_quick
webhook_url                       https://acme.thereforeonline.com/theservice/v0001/restun/SaveDocumentIndexDataQuick
webhook_header_Authorization      Basic dXNlcjpwYXNz          (base64 of user:password)
webhook_header_TenantName         acme                        (Therefore Online only; omit on-premises)
webhook_header_Content-Type       application/json
webhook_extra_doc_no              %DocNo%`}</pre>
        <p>Store the <code className="text-indigo-300 font-mono text-xs">verify_url</code> from the response in a workflow variable and open it for the reviewer.</p>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-3">
        <p className="text-slate-300 font-medium">Therefore REST Call — UpdateDocumentIndex (with concurrency token)</p>
        <p>Uses a pre-fetch to retrieve <code className="text-slate-300 font-mono text-xs">LastChangeTimeISO8601</code> immediately before rendering. Pre-fetch headers use the same prefixed pattern to avoid JSON mangling.</p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{`Field name                              Value
──────────────────────────────────────  ─────────────────────────────────────────────────────────────────
file                                    %Document%
verify                                  true
webhook_template                        therefore_update_index
webhook_url                             https://acme.thereforeonline.com/theservice/v0001/restun/UpdateDocumentIndex
webhook_header_Authorization            Basic dXNlcjpwYXNz
webhook_header_TenantName               acme
webhook_header_Content-Type             application/json
webhook_extra_doc_no                    %DocNo%
webhook_pre_fetch_url                   https://acme.thereforeonline.com/theservice/v0001/restun/GetDocumentIndexData
webhook_pre_fetch_method                POST
webhook_pre_fetch_header_Authorization  Basic dXNlcjpwYXNz
webhook_pre_fetch_header_TenantName     acme
webhook_pre_fetch_header_Content-Type   application/json
webhook_pre_fetch_body                  {"DocNo":{{ doc_no }}}`}</pre>
        <p className="text-xs text-slate-500">
          Note: <code className="font-mono">webhook_pre_fetch_header_*</code> prefixed fields are used (not <code className="font-mono">webhook_pre_fetch_headers</code> as JSON) to avoid Therefore's JSON mangling.
          The pre-fetch body <code className="font-mono">{"{{ doc_no }}"}</code> is itself a Jinja2 template rendered with the job context before the call is made.
        </p>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-3">
        <p className="text-slate-300 font-medium">Rendered Therefore body (example)</p>
        <p>When the human confirms code <strong className="text-slate-300">4.1.2</strong> for DocNo <strong className="text-slate-300">4521</strong>, the classifier POSTs this to Therefore:</p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{`POST https://acme.thereforeonline.com/theservice/v0001/restun/SaveDocumentIndexDataQuick
Authorization: Basic dXNlcjpwYXNz
TenantName: acme
Content-Type: application/json

{
  "DocNo": 4521,
  "CheckInComments": "ASA Classification — enrolment_form.pdf",
  "IndexData": {
    "IndexDataItems": [
      {"StringIndexData": {"FieldName": "ASACode",        "FieldNo": 0, "DataValue": "4.1.2"}},
      {"StringIndexData": {"FieldName": "ASAHierarchy",   "FieldNo": 0, "DataValue": "Student Records > Enrolment"}},
      {"StringIndexData": {"FieldName": "DisposalAction", "FieldNo": 0, "DataValue": "Destroy 7 years after student leaves."}}
    ],
    "DoFillDependentFields": true
  }
}`}</pre>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-400 space-y-3">
        <p className="text-slate-300 font-medium">Jinja2 template context variables</p>
        <p>These variables are available in all webhook templates:</p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{`{{ job_id }}              — job UUID
{{ filename }}            — original filename (e.g. "enrolment_form.pdf")
{{ stem }}                — filename without extension (e.g. "enrolment_form")
{{ confirmed_code }}      — confirmed ASA code (e.g. "4.1.2")
{{ confirmed_hierarchy }} — hierarchy string
{{ confirmed_disposal }}  — disposal action string
{{ confirmed_at }}        — ISO8601 confirmation timestamp
{{ metadata }}            — metadata dict passed at submit time
{{ fetched }}             — pre-fetch response (e.g. {{ fetched.IndexData.LastChangeTimeISO8601 }})

// All webhook_extra keys are promoted to top level:
{{ doc_no }}              — from webhook_extra_doc_no or webhook_extra={"doc_no":...}
{{ cat_no }}              — from webhook_extra_cat_no
// Any other webhook_extra keys work the same way`}</pre>
      </div>

      <ApiBlock
        method="GET"
        path="/api/admin/webhook-templates"
        description="List all available webhook templates — built-in Therefore templates plus any custom ones. Requires admin authentication."
        response={`{
  "therefore_save_index_quick": {
    "description": "Therefore SaveDocumentIndexDataQuick — ...",
    "body": "{ \"DocNo\": {{ doc_no }}, ... }",
    "builtin": true,
    "custom": false
  },
  "my_custom_template": {
    "description": "Custom template for cabinet X",
    "body": "...",
    "builtin": false,
    "custom": true
  }
}`}
        example={`curl -u admin:password http://localhost:8000/api/admin/webhook-templates`}
      />

      <ApiBlock
        method="PUT"
        path="/api/admin/webhook-templates/{name}"
        description="Create or update a custom webhook template. Built-in templates can be overridden but not deleted. Requires admin authentication."
        contentType="json"
        body={`{
  "description": "My custom Therefore template",
  "body": "{\\n  \\"DocNo\\": {{ doc_no }},\\n  ...\\n}"
}`}
        response={`{ "message": "Template 'my_template' saved." }`}
        example={`curl -X PUT -u admin:password \\
  http://localhost:8000/api/admin/webhook-templates/my_template \\
  -H "Content-Type: application/json" \\
  -d '{"description":"Custom template","body":"{ \\"DocNo\\": {{ doc_no }} }"}'`}
      />

      <ApiBlock
        method="DELETE"
        path="/api/admin/webhook-templates/{name}"
        description="Delete a custom webhook template. Built-in templates cannot be deleted. Requires admin authentication."
        response={`{ "message": "Template 'my_template' deleted." }`}
        example={`curl -X DELETE -u admin:password \\
  http://localhost:8000/api/admin/webhook-templates/my_template`}
      />

      {/* ── Training ── */}
      <GroupHeading>Training</GroupHeading>

      <ApiBlock
        method="POST"
        path="/api/train"
        description="Upload a document with a known ASA code to add it as a training example. Requires ALLOW_USER_TRAINING=true (controlled via admin settings)."
        body={`file      (file, required)        — the document
asa_code  (string, required)      — the correct ASA code
archive   (bool, default true)    — store the file for later review`}
        response={`{ "status": "added", "message": "Learned from report.pdf as 4.1.2." }

// Duplicate responses:
{ "status": "exact_duplicate", "message": "..." }
{ "status": "near_duplicate",  "message": "Similar example already exists (97% match)." }`}
        example={`curl -X POST http://localhost:8000/api/train \\
  -F "file=@enrolment_form.pdf" \\
  -F "asa_code=4.1.2"`}
      />

      <ApiBlock
        method="POST"
        path="/api/train/bulk"
        description="Upload multiple documents for the same ASA code in one request. Requires admin authentication."
        body={`files     (file[], required)      — one or more documents
asa_code  (string, required)      — the correct ASA code
archive   (bool, default true)    — store the files`}
        response={`{
  "succeeded":  ["doc1.pdf", "doc2.docx"],
  "duplicates": [{ "filename": "copy.pdf", "reason": "Near-duplicate of existing example." }],
  "failed":     [{ "filename": "bad.exe",  "error": "Unsupported file type" }]
}`}
        example={`curl -X POST http://localhost:8000/api/train/bulk \\
  -u admin:password \\
  -F "files=@doc1.pdf" \\
  -F "files=@doc2.docx" \\
  -F "asa_code=4.1.2"`}
      />

      <ApiBlock
        method="GET"
        path="/api/training/codes"
        description="List all ASA codes that have training examples, with example counts and last-trained timestamps. Requires admin authentication."
        response={`[
  {
    "asa_code": "4.1.2",
    "example_count": 5,
    "last_trained": "2025-06-01T14:32:00"
  }
]`}
        example={`curl -u admin:password http://localhost:8000/api/training/codes`}
      />

      <ApiBlock
        method="GET"
        path="/api/training/codes/{code}/examples"
        description="Return all training examples stored for a given ASA code. Requires admin authentication."
        response={`[
  {
    "id": "c6ac1807",
    "asa_code": "4.1.2",
    "filename": "enrolment.pdf",
    "archive_path": "docs/training_archive/4.1.2/...",
    "timestamp": "2025-06-01T14:32:00"
  }
]`}
        example={`curl -u admin:password http://localhost:8000/api/training/codes/4.1.2/examples`}
      />

      <ApiBlock
        method="DELETE"
        path="/api/training/examples/{id}"
        description="Delete a training example by ID. Pass delete_file=true to also remove the archived file from disk. Requires admin authentication."
        body={`delete_file  (bool, default false, query param)`}
        response={`{ "message": "Deleted." }`}
        example={`curl -X DELETE -u admin:password \\
  "http://localhost:8000/api/training/examples/c6ac1807?delete_file=true"`}
      />

      {/* ── System ── */}
      <GroupHeading>System</GroupHeading>

      <ApiBlock
        method="GET"
        path="/api/settings"
        description="Public settings consumed by the frontend. No authentication required."
        response={`{
  "allow_user_training": true,
  "admin_auth_enabled": true
}`}
        example={`curl http://localhost:8000/api/settings`}
      />

      <ApiBlock
        method="GET"
        path="/api/health"
        description="Health check endpoint."
        response={`{ "status": "ok" }`}
        example={`curl http://localhost:8000/api/health`}
      />
    </div>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState(0)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-white">Help &amp; API Reference</h1>
            </div>
            <p className="text-slate-500 text-sm ml-11">ASA Retention Schedule Classifier</p>
          </div>
          <Link
            to="/"
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5 mt-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back
          </Link>
        </div>

        {/* Section switcher */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 mb-8">
          {SECTIONS.map((s, i) => (
            <button
              key={s}
              onClick={() => setActiveSection(i)}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                activeSection === i
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {activeSection === 0 && <UserGuide />}
        {activeSection === 1 && <ApiReference />}
      </div>
    </div>
  )
}
