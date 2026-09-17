# Scarica (o verifica) i modelli di Docling nella cache HuggingFace, con le
# STESSE opzioni del servizio (tabella ACCURATE + cell-matching), così il primo
# /parse a runtime non deve scaricare né ricostruire nulla.
#
# ATTENZIONE: costruire il DocumentConverter NON basta (Docling >= 2.12x carica
# i modelli in modo LAZY alla prima conversione): la versione precedente di
# questo script "pre-scaricava" senza scaricare nulla e in produzione il primo
# /parse restava bloccato su "Loading weights" (e con la rete chiusa → HTTP 500,
# LocalEntryNotFoundError). Qui si CONVERTE davvero un PDF minimo con testo e
# una tabella: passa da layout, TableFormer e cell-matching, quindi scarica
# tutti i pesi che il servizio userà.
import io
import os
import sys

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from docling.datamodel.base_models import DocumentStream  # noqa: E402

# main.py è nella stessa cartella: STESSA configurazione del servizio.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from main import get_converter  # noqa: E402

# PDF minimo (una pagina, testo + due righe allineate a colonna) scritto a mano:
# niente dipendenze extra per generarlo.
_CONTENT = b"""BT
/F1 14 Tf 50 750 Td (Polizza n. 123456 - Contraente ROSSI SRL) Tj
0 -30 Td (Premio imponibile   1.270,10   Imposte   269,90   Premio lordo   1.540,00) Tj
0 -20 Td (Premio totale       1.270,10   Imposte   269,90   Premio lordo   1.540,00) Tj
ET"""
_PDF = b"".join([
    b"%PDF-1.4\n",
    b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
    b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    b"5 0 obj << /Length " + str(len(_CONTENT)).encode() + b" >> stream\n" + _CONTENT + b"\nendstream endobj\n",
    b"trailer << /Root 1 0 R >>\n%%EOF\n",
])

conv = get_converter()
res = conv.convert(DocumentStream(name="predownload.pdf", stream=io.BytesIO(_PDF)))
md = res.document.export_to_markdown()
assert md.strip(), "conversione di prova vuota: modelli non caricati?"
print(f"Modelli Docling pre-scaricati e verificati con una conversione reale ({len(md)} char di markdown)")
