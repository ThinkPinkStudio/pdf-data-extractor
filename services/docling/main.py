#! /usr/bin/env python3
"""Microservizio Docling: converte PDFs in Markdown strutturato (layout-aware).

Espone:
  POST /parse   body json {"filename": str, "content_base64": str}
                -> {"markdown": str, "pages": [str, ...], "num_pages": int}
  GET  /health  -> {"ok": true, "docling": "2.126+"}

Avvio:  uvicorn main:app --host 0.0.0.0 --port 8101 --workers 1
"""
import base64
import io
import time
import traceback

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="docling-parse", version="1.0.0")

# Import pesante e una sola volta (primo avvio scarica i model layout).
from docling.document_converter import DocumentConverter  # noqa: E402
from docling.datamodel.base_models import DocumentStream  # noqa: E402

_converter = None


def get_converter():
    global _converter
    if _converter is None:
        _converter = DocumentConverter()
    return _converter


class ParseRequest(BaseModel):
    filename: str = "documento.pdf"
    content_base64: str


class ParseResponse(BaseModel):
    markdown: str
    pages: list[str]
    num_pages: int
    seconds: float


@app.get("/health")
def health():
    return {"ok": True, "docling": "2.126+"}


@app.post("/parse", response_model=ParseResponse)
def parse(req: ParseRequest):
    t0 = time.time()
    try:
        raw = base64.b64decode(req.content_base64)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"base64 non valido: {e}") from e
    if not raw:
        raise HTTPException(status_code=400, detail="contenuto vuoto")
    try:
        conv = get_converter()
        stream = DocumentStream(name=req.filename, stream=io.BytesIO(raw))
        res = conv.convert(stream)
        md = res.document.export_to_markdown()
        # pagine: docling non espone un split per-pagina semplice nel markdown;
        # restituiamo il markdown uniforme come unico blocco (il motore staged
        # lo tratta come testo strutturato).
        pages = [md]
        return ParseResponse(
            markdown=md,
            pages=pages,
            num_pages=len(res.pages or []) if hasattr(res, "pages") else 1,
            seconds=round(time.time() - t0, 2),
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"conversione fallita: {e}") from e