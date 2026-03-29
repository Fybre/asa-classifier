import requests
import os
from abc import ABC, abstractmethod
import subprocess
import pdfplumber
import docx
import pandas as pd

class OCREngine(ABC):
    @abstractmethod
    def extract_text(self, file_path: str) -> str:
        pass

class TesseractLocal(OCREngine):
    """
    Fastest, lowest-resource, but poor at handwriting.
    """
    def extract_text(self, file_path: str) -> str:
        try:
            # Requires 'tesseract' installed on system
            # 'pip install pytesseract' or simple subprocess call
            result = subprocess.run(['tesseract', file_path, 'stdout'], capture_output=True, text=True)
            return result.stdout
        except Exception as e:
            print(f"Tesseract failed: {e}")
            return ""

class DockerizedOCR(OCREngine):
    """
    Fallback for high-quality OCR/ICR (e.g. DocTR/PaddleOCR running in a container)
    """
    def __init__(self, endpoint_url: str):
        self.url = endpoint_url

    def extract_text(self, file_path: str) -> str:
        if not self.url:
            return ""
        try:
            with open(file_path, 'rb') as f:
                response = requests.post(self.url, files={'file': f})
                # Assuming the container returns a JSON like {"text": "..."}
                return response.json().get('text', "")
        except Exception as e:
            print(f"Remote OCR failed: {e}")
            return ""

import config

class OCRService:
    def __init__(self, remote_url=None):
        self.engines = [TesseractLocal()]
        if remote_url:
            self.engines.append(DockerizedOCR(remote_url))

    def _extract_pdf_text_layer(self, file_path: str) -> str:
        """Extract embedded text from a PDF without OCR."""
        try:
            with pdfplumber.open(file_path) as pdf:
                pages_text = [page.extract_text() or "" for page in pdf.pages]
            return "\n".join(pages_text)
        except Exception as e:
            print(f"PDF text layer extraction failed: {e}")
            return ""

    def _extract_txt(self, file_path: str) -> str:
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception as e:
            print(f"TXT extraction failed: {e}")
            return ""

    def _extract_docx(self, file_path: str) -> str:
        try:
            doc = docx.Document(file_path)
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            print(f"DOCX extraction failed: {e}")
            return ""

    def _extract_excel(self, file_path: str) -> str:
        try:
            sheets = pd.read_excel(file_path, sheet_name=None, dtype=str)
            parts = []
            for sheet_name, df in sheets.items():
                parts.append(f"[Sheet: {sheet_name}]")
                parts.append(df.fillna("").to_string(index=False))
            return "\n".join(parts)
        except Exception as e:
            print(f"Excel extraction failed: {e}")
            return ""

    def process(self, file_path: str) -> str:
        """
        Extracts text directly for TXT/DOCX/XLSX/XLS.
        For PDFs, tries the text layer first then falls back to OCR.
        For images, goes straight to OCR.
        """
        if config.DEBUG_MODE:
            print(f"[DEBUG] Starting extraction for: {file_path}")

        ext = os.path.splitext(file_path)[1].lower()

        if ext == ".txt":
            return self._extract_txt(file_path)

        if ext == ".docx":
            return self._extract_docx(file_path)

        if ext in (".xlsx", ".xls"):
            return self._extract_excel(file_path)

        if ext == ".pdf":
            text = self._extract_pdf_text_layer(file_path)
            if self._is_meaningful_text(text):
                if config.DEBUG_MODE:
                    print(f"[DEBUG] PDF text layer used. Extracted {len(text)} chars.")
                    print(f"[DEBUG] Text Preview: {text[:200].replace(chr(10), ' ')}...")
                return text
            if config.DEBUG_MODE:
                print("[DEBUG] PDF text layer insufficient, falling back to OCR.")

        for engine in self.engines:
            if config.DEBUG_MODE:
                print(f"[DEBUG] Attempting engine: {engine.__class__.__name__}")

            text = engine.extract_text(file_path)

            if self._is_meaningful_text(text):
                if config.DEBUG_MODE:
                    preview = text[:200].replace('\n', ' ')
                    print(f"[DEBUG] Success with {engine.__class__.__name__}. Extracted {len(text)} chars.")
                    print(f"[DEBUG] Text Preview: {preview}...")
                return text

            if config.DEBUG_MODE:
                print(f"[DEBUG] Engine {engine.__class__.__name__} returned insufficient or low-quality text.")

        return ""

    def _is_meaningful_text(self, text: str) -> bool:
        """
        Returns True only if text looks like real content, not OCR noise from photos.
        Rejects text that is too short, has too few unique characters, or looks like
        repeated garbage (e.g. Tesseract returning 'eeeeee' from a photo).
        """
        t = text.strip()
        if len(t) < 30:
            return False
        # Must have reasonable character variety (at least 8 distinct chars)
        if len(set(t.lower())) < 8:
            return False
        # Must contain at least one space (real text has words)
        if ' ' not in t:
            return False
        # Most dominant character shouldn't make up >40% of the text
        # (catches 'eeeeeee' style garbage from photo OCR)
        from collections import Counter
        most_common_count = Counter(t.lower()).most_common(1)[0][1]
        if most_common_count / len(t) > 0.40:
            return False
        return True
