#! /usr/bin/env python3
"""Microservizio Docling: converte PDFs in Markdown strutturato (layout-aware).

Espone:
  POST /parse   body json {"filename": str, "content_base64": str}
                -> {"markdown": str, "pages": [str, ...], "num_pages": int}
                   pages = markdown PER PAGINA (allineato alle pagine del PDF),
                   markdown = documento intero
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
from docling.datamodel.pipeline_options import (  # noqa: E402
    PdfPipelineOptions, TableStructureOptions, TableFormerMode,
)

_converter = None


def _make_opts():
    # CPU-only: niente OCR (i PDF arrivano col loro testo).
    # Tabella in modalità ACCURATE con cell-matching: di default (FAST)
    # TableFormer LASCIAVA CADERE metà celle ("40 of 83 pdf cells ... dropped
    # from the table", visto nei log) → markdown con tabelle rotte e
    # estrazione penosa in produzione.
    opts = PdfPipelineOptions()
    opts.do_ocr = False
    try:
        opts.table_structure_options = TableStructureOptions(
            mode=TableFormerMode.ACCURATE,
            do_cell_matching=True,
        )
    except Exception:  # pragma: no cover — API diversa: usa i default
        pass
    return opts


def get_converter():
    global _converter
    if _converter is None:
        from docling.document_converter import PdfFormatOption  # noqa: E402
        from docling.datamodel.base_models import InputFormat  # noqa: E402
        opts = _make_opts()
        # API Docling >= 2.120: `pipeline_options` NON è più kwarg del ctor.
        try:
            _converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
        except TypeError:
            _converter = DocumentConverter(pipeline_options=opts)
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
        # Markdown PER PAGINA (export_to_markdown(page_no=N), docling-core >= 2.x):
        # il worker allinea pages[i] alla griglia spaziale pdfjs della stessa
        # pagina, così le TABELLE Docling finiscono nel batch della pagina giusta
        # e il motore spezza il documento per pagine invece di ricevere un blob
        # unico da decine di KB (che non entra nel contesto 8192). Se l'export
        # per pagina non è disponibile o non torna, si ripiega sul blocco unico.
        num_pages = len(res.document.pages or {}) if getattr(res.document, "pages", None) else (
            len(res.pages or []) if hasattr(res, "pages") else 1
        )
        pages = []
        try:
            if num_pages and num_pages > 1:
                for n in range(1, num_pages + 1):
                    pages.append(res.document.export_to_markdown(page_no=n) or "")
        except Exception:  # pragma: no cover — API diversa: blocco unico
            pages = []
        if not pages or not any(p.strip() for p in pages):
            pages = [md]
        return ParseResponse(
            markdown=md,
            pages=pages,
            num_pages=num_pages or len(pages),
            seconds=round(time.time() - t0, 2),
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"conversione fallita: {e}") from e