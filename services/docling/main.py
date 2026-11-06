#! /usr/bin/env python3
"""Microservizio Docling: converte PDFs in Markdown strutturato (layout-aware).

Espone:
  POST /parse   body json {"filename": str, "content_base64": str}
                -> {"markdown": str, "pages": [str, ...], "num_pages": int}
                   pages = markdown PER PAGINA (allineato alle pagine del PDF),
                   markdown = documento intero
  POST /layout  body json {"content_base64": str, "pages": [int]?, "long_side": int?, "threshold": float?}
                -> {"pages": [{"page": n, "boxes": [{"label", "score", "l", "t", "r", "b"}]}]}
                   riquadri delle TABELLE per pagina (coordinate 0-1, origine in alto a
                   sinistra) da PP-DocLayoutV2 (RapidLayout, onnxruntime): per le pagine
                   SCANSIONATE, che il worker ritaglia e manda a un modello per tabelle
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
    return {"ok": True, "docling": "2.126+", "layout": True}


# ── Riquadri delle tabelle (flag «tabelleocr» del worker, 08/10/2026) ─────────
# Sulle pagine SCANSIONATE il modello visivo trascrive il testo ma non
# incolonna le tabelle. Il rilevatore di layout trova i riquadri delle tabelle;
# il worker ritaglia la sua immagine della pagina e li manda a GLM-OCR («Table
# Recognition:»), che restituisce le celle esplicite. PP-DocLayoutV2 (ONNX, CPU,
# ~0,4 s a pagina): sulle schede DAS scansionate trova le tabelle dei premi
# anche dove il layout di Docling (heron) non le vede.
_layout = {}


def get_layout(model: str):
    if model not in _layout:
        from rapid_layout import RapidLayout, RapidLayoutInput, ModelType  # noqa: E402
        _layout[model] = RapidLayout(cfg=RapidLayoutInput(model_type=ModelType(model), conf_thresh=0.5))
    return _layout[model]


class LayoutRequest(BaseModel):
    content_base64: str
    pages: list[int] | None = None
    long_side: int = 1800
    threshold: float = 0.5
    model: str = "pp_doc_layoutv2"


@app.post("/layout")
def layout(req: LayoutRequest):
    t0 = time.time()
    try:
        raw = base64.b64decode(req.content_base64)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"base64 non valido: {e}") from e
    try:
        import numpy as np  # noqa: E402
        import pypdfium2 as pdfium  # noqa: E402
        eng = get_layout(req.model)
        doc = pdfium.PdfDocument(raw)
        n = len(doc)
        sel = [p for p in (req.pages or range(1, n + 1)) if 1 <= p <= n]
        out = []
        for p in sel:
            page = doc[p - 1]
            w, h = page.get_size()
            img = page.render(scale=max(0.1, req.long_side / max(w, h))).to_pil().convert("RGB")
            res = eng(np.array(img)[:, :, ::-1])
            W, H = img.size
            boxes = []
            for b, lab, sc in zip(res.boxes, res.class_names, res.scores):
                if lab != "table" or float(sc) < req.threshold:
                    continue
                x0, y0, x1, y1 = [float(v) for v in b]
                boxes.append({"label": lab, "score": round(float(sc), 3),
                              "l": round(x0 / W, 4), "t": round(y0 / H, 4), "r": round(x1 / W, 4), "b": round(y1 / H, 4)})
            out.append({"page": p, "boxes": boxes})
        return {"pages": out, "seconds": round(time.time() - t0, 2)}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"layout fallito: {e}") from e


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
        # escape_html=False: di default Docling scrive "&amp;", "&lt;"… nel
        # markdown ("GUFFANTI GROUP &amp; PARTNERS"): il modello ricopia le
        # entità nei valori e la ricerca letterale dei valori fallisce. Il
        # markdown va a un LLM, non a un browser: niente escape (né degli
        # underscore, che diventavano "LUCCA\_VIVIANA").
        _MD_OPTS = dict(escape_html=False, escape_underscores=False)
        md = res.document.export_to_markdown(**_MD_OPTS)
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
                    pages.append(res.document.export_to_markdown(page_no=n, **_MD_OPTS) or "")
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