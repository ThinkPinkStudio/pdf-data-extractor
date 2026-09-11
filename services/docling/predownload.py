# Scarica (o verifica) i modelli layout di Docling nella cache HuggingFace,
# così il primo /parse a runtime non deve scaricare i pesi (visto in
# produzione: "Loading weights" e boot bloccato per minuti).
import os

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions

opts = PdfPipelineOptions()
opts.do_ocr = False
try:
    DocumentConverter(format_options={"pdf": PdfFormatOption(pipeline_options=opts)})
except TypeError:
    DocumentConverter(pipeline_options=opts)
print("Modelli Docling pre-scaricati in /root/.cache/huggingface")