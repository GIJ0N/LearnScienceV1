# hosting_ready_v1: imagen mínima para alojar Ruta detrás de un proxy con HTTPS (ver docs/hosting_v1.md). Sin secretos en la imagen.
FROM python:3.12-slim

# Usuario sin privilegios; la base SQLite vive en el volumen /data.
RUN useradd --system --create-home --uid 10001 ruta && mkdir /data && chown ruta /data
WORKDIR /app
COPY app_legacy.py memory_store.py hosting.py explore_expr.py ./

ENV PYTHONUNBUFFERED=1 \
    PORT=8765 \
    RUTA_DB_PATH=/data/ruta-memory.sqlite3 \
    LEARNSCIENCE_HOST=0.0.0.0 \
    LEARNSCIENCE_AUTH=required \
    LEARNSCIENCE_TRUST_PROXY=1
# En tiempo de ejecución (nunca aquí): GEMINI_API_KEY (o ANTHROPIC_API_KEY) y LEARNSCIENCE_ORIGINS=https://tu-dominio.

USER ruta
VOLUME /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8765')+'/api/health',timeout=3)"
CMD ["python", "app_legacy.py"]
