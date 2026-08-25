FROM python:3.11-slim

WORKDIR /srv

COPY backend/requirements.txt /srv/backend/requirements.txt
RUN pip install --no-cache-dir -r /srv/backend/requirements.txt \
    && useradd --system --uid 10001 --create-home appuser

COPY src/layouts/catalog.json /srv/src/layouts/catalog.json
COPY backend /srv/backend

WORKDIR /srv/backend
USER appuser
EXPOSE 8000
ENV APP_ENV=production
ENV DEBUG=false
ENV HOST=0.0.0.0
ENV PORT=8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
