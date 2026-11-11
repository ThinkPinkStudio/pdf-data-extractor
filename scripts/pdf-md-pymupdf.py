#!/usr/bin/env python3
"""PDF → markdown per pagina con PyMuPDF4LLM (nessun modello ML, CPU, ms/pagina).

Uso: python3 scripts/pdf-md-pymupdf.py <file.pdf>   → JSON {"pages": [md, ...]}
Serve al confronto di copertura (scripts/coverage-check.mjs) e come candidato
alternativo a Docling per i PDF con text layer.
"""
import contextlib
import json
import sys

# pymupdf4llm/pymupdf-layout scrivono messaggi su STDOUT ("OCR on page…"):
# li dirottiamo su stderr, così stdout resta JSON puro per chi ci chiama.
with contextlib.redirect_stdout(sys.stderr):
    import pymupdf4llm

    path = sys.argv[1]
    chunks = pymupdf4llm.to_markdown(path, page_chunks=True, show_progress=False)
pages = [(c.get("text") if isinstance(c, dict) else str(c)) or "" for c in chunks]
print(json.dumps({"pages": pages, "num_pages": len(pages)}, ensure_ascii=False))
