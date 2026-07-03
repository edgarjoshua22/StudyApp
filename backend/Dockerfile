FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Bind to a fixed 8000 to match Railway's manually-pinned target port. Workers
# default to 2 (tunable via WEB_CONCURRENCY) to keep memory down while PDF
# processing + embedding runs inside the workers. Shell form + exec lets
# ${WEB_CONCURRENCY} expand while still forwarding SIGTERM for clean shutdowns.
CMD ["sh", "-c", "exec gunicorn main:app \
     -k uvicorn.workers.UvicornWorker \
     --workers ${WEB_CONCURRENCY:-2} \
     --bind 0.0.0.0:8000 \
     --timeout 120 \
     --keep-alive 30"]