"""
Webhook delivery with HMAC-SHA256 signing, Jinja2 template rendering,
and optional pre-fetch for concurrency tokens (e.g. Therefore LastChangeTimeISO8601).

Designed for Therefore DMS integration:
  - webhook_url  → Therefore REST endpoint (SaveDocumentIndexDataQuick, UpdateDocumentIndex, …)
  - webhook_template → named Jinja2 template that renders the Therefore-structured body
  - webhook_headers  → must include Authorization and TenantName for Therefore Online
  - webhook_extra    → doc_no and any other vars promoted into the Jinja2 context
  - pre_fetch_*      → calls GetDocumentIndexData before rendering to get LastChangeTimeISO8601
"""
import hashlib
import hmac
import json
import logging
import time
from pathlib import Path
from typing import Optional, Tuple

import requests
from jinja2 import Template, TemplateError

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0
_LARGE_TIMEOUT = 60.0
_LARGE_THRESHOLD = 100_000


def build_template_context(
    job: dict,
    confirmed_code: str,
    confirmed_hierarchy: str,
    confirmed_disposal: str,
) -> dict:
    """
    Build the Jinja2 template rendering context from a confirmed job.

    All keys from webhook_extra are promoted to the top level so that
    Therefore-specific vars like {{ doc_no }} and {{ cat_no }} resolve
    directly without needing the dict prefix.
    """
    context = {
        "job_id":              job.get("id", ""),
        "filename":            job.get("filename", ""),
        "stem":                Path(job.get("filename", "")).stem,
        "confirmed_code":      confirmed_code,
        "confirmed_hierarchy": confirmed_hierarchy,
        "confirmed_disposal":  confirmed_disposal,
        "confirmed_at":        job.get("confirmed_at", ""),
        "metadata":            job.get("metadata") or {},
        "fetched":             {},   # populated by pre-fetch if configured
    }
    # Promote webhook_extra keys so {{ doc_no }} etc. work at top level
    for k, v in (job.get("webhook_extra") or {}).items():
        context[k] = v
    return context


def fetch_pre_fetch_context(
    url: str,
    headers: Optional[dict] = None,
    method: str = "GET",
    body: Optional[str] = None,
) -> dict:
    """
    Call a Therefore endpoint (e.g. GetDocumentIndexData) before rendering
    the main template and return the parsed JSON response as the `fetched` dict.
    """
    logger.info(f"pre_fetch {method} {url}")
    try:
        req_headers = {"Content-Type": "application/json", **(headers or {})}
        if method.upper() == "POST":
            resp = requests.post(url, data=(body or "").encode(), headers=req_headers, timeout=_TIMEOUT)
        else:
            resp = requests.get(url, headers=req_headers, timeout=_TIMEOUT)
        if resp.status_code < 400:
            logger.info(f"pre_fetch {method} {url} -> HTTP {resp.status_code}")
            return resp.json()
        logger.warning(f"pre_fetch {method} {url} returned HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"pre_fetch {method} {url} failed: {e}")
    return {}


def render_webhook_template(
    template_str: str,
    context: dict,
    pre_fetch_url: Optional[str] = None,
    pre_fetch_headers: Optional[dict] = None,
    pre_fetch_method: str = "GET",
    pre_fetch_body: Optional[str] = None,
) -> bytes:
    """
    Render a Jinja2 webhook template, optionally pre-fetching data first.

    If pre_fetch_url is set:
      1. Both pre_fetch_url and pre_fetch_body are themselves rendered as Jinja2
         templates so they can reference context vars like {{ doc_no }}.
      2. The result is injected as context["fetched"], making
         {{ fetched.IndexData.LastChangeTimeISO8601 }} available in the main template.

    Returns the rendered bytes ready to POST to Therefore.
    Raises TemplateError if the template is malformed.
    """
    if pre_fetch_url:
        rendered_url = Template(pre_fetch_url).render(**context)
        rendered_body = Template(pre_fetch_body).render(**context) if pre_fetch_body else None
        context["fetched"] = fetch_pre_fetch_context(
            rendered_url,
            pre_fetch_headers,
            method=pre_fetch_method,
            body=rendered_body,
        )
    rendered = Template(template_str).render(**context)
    return rendered.encode()


def send_webhook(
    url: str,
    payload: dict,
    secret: Optional[str] = None,
    extra_headers: Optional[dict] = None,
    max_retries: int = 3,
    raw_body: Optional[bytes] = None,
) -> Tuple[bool, Optional[int]]:
    """
    POST a signed webhook. If raw_body is provided (a rendered Jinja2 template),
    it is sent as-is; otherwise payload is JSON-serialised.

    extra_headers are merged last so they can override all defaults — this is
    where Therefore's TenantName and Authorization headers must appear.

    Returns (success, last_http_status_code).
    Retries with exponential backoff on connection errors or non-2xx responses.
    """
    body = raw_body if raw_body is not None else json.dumps(payload, default=str).encode()
    timeout = _LARGE_TIMEOUT if len(body) > _LARGE_THRESHOLD else _TIMEOUT

    headers = {
        "Content-Type": "application/json",
        "X-ASA-Timestamp": str(int(time.time())),
        "User-Agent": "ASA-Classifier/1.0",
    }
    if secret:
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-ASA-Signature"] = f"sha256={sig}"
    # extra_headers override defaults — TenantName, Authorization, etc. land here
    if extra_headers:
        headers.update(extra_headers)

    last_status: Optional[int] = None
    for attempt in range(max_retries):
        try:
            resp = requests.post(url, data=body, headers=headers, timeout=timeout)
            last_status = resp.status_code
            if resp.status_code < 400:
                logger.info(f"Webhook delivered to {url} (HTTP {resp.status_code})")
                return True, resp.status_code
            logger.warning(
                f"Webhook attempt {attempt + 1} failed: HTTP {resp.status_code} — {resp.text[:200]}"
            )
        except Exception as e:
            logger.warning(f"Webhook attempt {attempt + 1} error: {e}")

        if attempt < max_retries - 1:
            time.sleep(2 ** attempt)

    logger.error(f"Webhook permanently failed after {max_retries} attempts: {url}")
    return False, last_status
