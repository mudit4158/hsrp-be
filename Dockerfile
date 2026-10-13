# FastAPI backend (D48, D49).
FROM python:3.13-slim

# Tesseract for the plate photo OCR (D45); English model only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
# Dependencies from pyproject.toml; the app itself runs from /app (alembic.ini, alembic/ and the seed fixtures sit next
# to it), so the package is uninstalled again after its dependencies are in.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir . && pip uninstall -y hsrp-be
COPY alembic.ini ./
COPY alembic ./alembic
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
