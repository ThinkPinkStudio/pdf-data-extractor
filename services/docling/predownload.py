# Scarica (o verifica) i modelli layout di Docling nella cache HuggingFace,
# con le STESSE opzioni del servizio (tabella ACCURATE + cell-matching),
# così il primo /parse a runtime non deve scaricare né ricostruire nulla.
import os

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions, TableStructureOptions, TableFormerMode,
)

opts = PdfPipelineOptions()
opts.do_ocr = False
try:
    opts.table_structure_options = TableStructureOptions(
        mode=TableFormerMode.ACCURATE,
        do_cell_matching=True,
    )
except Exception:
    pass
try:
    DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
except TypeError:
    DocumentConverter(pipeline_options=opts)
print("Modelli Docling pre-scaricati in /root/.cache/huggingface")