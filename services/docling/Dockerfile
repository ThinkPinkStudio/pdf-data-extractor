# Servizio Docling: PDF → Markdown strutturato (layout-aware).
# Base Python 3.11 (stabile per onnx/torch/docling).
FROM python:3.11-slim

WORKDIR /srv

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# lib di sistema per cv2/opencv nel container (libxcb/libGL mancanti → ImportError)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxcb1 libxcb-xfixes0 libxcb-shape0 libxcb-render0 \
    libgl1 libglib2.0-0 libpango-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# --extra-index-url https://download.pytorch.org/whl/cpu: docling dipende da
# torch/torchvision, ma da PyPI prenderebbe i wheel CUDA (~4 GB) che fanno
# fallire la build per disco/RAM. Qui scarica i wheel CPU-only.
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

COPY main.py predownload.py .
# PREDOWNLOAD dei modelli layout di Docling (TableFormer/layout-heron, ~500 MB):
# senza questo, il primo /parse scarica i pesi dal HuggingFace Hub e resta
# bloccato per minuti (visto in produzione: "Loading weights"). Qui i pesi
# entrano NELL'IMMAGINE: a runtime il modello è già in /root/.cache/huggingface.
RUN python predownload.py && rm predownload.py

EXPOSE 8101

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8101", "--workers", "1"]