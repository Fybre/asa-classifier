"""
SQLite-backed job store for classification jobs submitted via /api/jobs/submit.

Each job tracks the submitted document, classification suggestions, webhook
configuration, and the final confirmed result.  The DB file lives inside the
asa_vector_db directory so it is persisted by the same Docker volume.

Job lifecycle
─────────────
pending_verification  →  confirmed  (human or programmatic confirm)
                     →  expired    (future: TTL cleanup)

After the webhook fires and the job document is deleted the record is removed
from the database entirely.

Therefore integration
─────────────────────
When the caller is Therefore DMS, the webhook_url points to a Therefore REST
endpoint (SaveDocumentIndexDataQuick or UpdateDocumentIndex).  The body is
rendered from a Jinja2 template (webhook_template) and Therefore-specific
headers (TenantName, Authorization) are stored in webhook_headers.

For UpdateDocumentIndex a pre-fetch call to GetDocumentIndexData retrieves
the LastChangeTimeISO8601 concurrency token before the template is rendered.
These pre-fetch settings are stored in the webhook_pre_fetch_* columns.
"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional

_DB_PATH = os.path.join("asa_vector_db", "jobs.db")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id                      TEXT PRIMARY KEY,
                filename                TEXT NOT NULL,
                file_ext                TEXT NOT NULL,
                document_path           TEXT,
                status                  TEXT NOT NULL DEFAULT 'pending_verification',
                suggestions             TEXT,
                extracted_text          TEXT,
                confirmed_code          TEXT,
                confirmed_hierarchy     TEXT,
                confirmed_disposal      TEXT,
                confirmed_at            TEXT,
                webhook_url             TEXT,
                webhook_headers         TEXT,
                webhook_secret          TEXT,
                webhook_extra           TEXT,
                webhook_template        TEXT,
                webhook_pre_fetch_url   TEXT,
                webhook_pre_fetch_headers TEXT,
                webhook_pre_fetch_method  TEXT,
                webhook_pre_fetch_body    TEXT,
                webhook_sent            INTEGER NOT NULL DEFAULT 0,
                webhook_status          INTEGER,
                metadata                TEXT,
                created_at              TEXT NOT NULL
            )
        """)
        # Migration: add columns that may be absent in older schemas
        _add_columns_if_missing(c, [
            ("webhook_template",          "TEXT"),
            ("webhook_pre_fetch_url",     "TEXT"),
            ("webhook_pre_fetch_headers", "TEXT"),
            ("webhook_pre_fetch_method",  "TEXT"),
            ("webhook_pre_fetch_body",    "TEXT"),
        ])
        c.commit()


def _add_columns_if_missing(conn: sqlite3.Connection, columns: list) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
    for col_name, col_type in columns:
        if col_name not in existing:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {col_name} {col_type}")


_init()


def _parse(row) -> Optional[dict]:
    if row is None:
        return None
    d = dict(row)
    for key in ("suggestions", "webhook_headers", "webhook_extra",
                "webhook_pre_fetch_headers", "metadata"):
        raw = d.get(key)
        try:
            d[key] = json.loads(raw) if raw else ([] if key == "suggestions" else {})
        except (json.JSONDecodeError, TypeError):
            d[key] = [] if key == "suggestions" else {}
    return d


def create_job(
    *,
    job_id: str,
    filename: str,
    file_ext: str,
    document_path: str,
    suggestions: list,
    extracted_text: str = "",
    webhook_url: str = None,
    webhook_headers: dict = None,
    webhook_secret: str = None,
    webhook_extra: dict = None,
    webhook_template: str = None,
    webhook_pre_fetch_url: str = None,
    webhook_pre_fetch_headers: dict = None,
    webhook_pre_fetch_method: str = "GET",
    webhook_pre_fetch_body: str = None,
    metadata: dict = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute(
            """
            INSERT INTO jobs
              (id, filename, file_ext, document_path, status,
               suggestions, extracted_text,
               webhook_url, webhook_headers, webhook_secret,
               webhook_extra, webhook_template,
               webhook_pre_fetch_url, webhook_pre_fetch_headers,
               webhook_pre_fetch_method, webhook_pre_fetch_body,
               metadata, created_at)
            VALUES (?, ?, ?, ?, 'pending_verification', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, filename, file_ext, document_path,
                json.dumps(suggestions),
                extracted_text,
                webhook_url,
                json.dumps(webhook_headers or {}),
                webhook_secret,
                json.dumps(webhook_extra or {}),
                webhook_template,
                webhook_pre_fetch_url,
                json.dumps(webhook_pre_fetch_headers or {}),
                webhook_pre_fetch_method or "GET",
                webhook_pre_fetch_body,
                json.dumps(metadata or {}),
                now,
            ),
        )
        c.commit()


def get_job(job_id: str) -> Optional[dict]:
    with _conn() as c:
        row = c.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _parse(row)


def confirm_job(
    job_id: str,
    confirmed_code: str,
    confirmed_hierarchy: str,
    confirmed_disposal: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute(
            """
            UPDATE jobs
            SET status = 'confirmed',
                confirmed_code = ?,
                confirmed_hierarchy = ?,
                confirmed_disposal = ?,
                confirmed_at = ?
            WHERE id = ?
            """,
            (confirmed_code, confirmed_hierarchy, confirmed_disposal, now, job_id),
        )
        c.commit()


def mark_webhook_sent(job_id: str, status_code: int) -> None:
    with _conn() as c:
        c.execute(
            "UPDATE jobs SET webhook_sent = 1, webhook_status = ? WHERE id = ?",
            (status_code, job_id),
        )
        c.commit()


def delete_job(job_id: str) -> None:
    """Remove the job record from the database."""
    with _conn() as c:
        c.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        c.commit()
