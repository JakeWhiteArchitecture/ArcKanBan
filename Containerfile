# ArcKanban — container image. Works with Podman (Fedora's default) or Docker.
#
#   podman build -t arckanban .
#   podman run -d --name arckanban -p 127.0.0.1:5000:5000 -v arckanban-data:/data arckanban
#   → open http://127.0.0.1:5000
#
# The database lives on the named volume (arckanban-data), so it survives the
# container being stopped, removed, or rebuilt after a `git pull`.
FROM python:3.12-slim

# Inside the container the server binds to all interfaces (the host publishes it
# to 127.0.0.1 only); the database is kept on the mounted /data volume.
ENV ARCKANBAN_HOST=0.0.0.0 \
    ARCKANBAN_PORT=5000 \
    ARCKANBAN_DB=/data/arckanban.db \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so this layer is cached unless requirements change.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY . .

# Persisted data (the SQLite file). Mount a volume here to keep it.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 5000
# serve.py runs the schema migration, then Waitress.
CMD ["python", "serve.py"]
