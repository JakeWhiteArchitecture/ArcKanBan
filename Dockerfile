# ArcKanban — container image (Docker or Podman).
#
#   docker build -t arckanban .
#   docker run -d --name arckanban -p 127.0.0.1:5000:5000 -v arckanban-data:/data arckanban
#   → open http://127.0.0.1:5000
#
# The database lives on the named volume (arckanban-data), so it survives the
# container being stopped, removed, or rebuilt after a `git pull`.
FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The server binds to all interfaces inside the container (the host publishes
# it to whatever address you choose); ARCKANBAN_SERVER=waitress runs it under
# Waitress rather than Flask's dev server; the database lives on the mounted
# /data volume so it survives the container being rebuilt.
ENV ARCKANBAN_HOST=0.0.0.0
ENV ARCKANBAN_PORT=5000
ENV ARCKANBAN_SERVER=waitress
ENV ARCKANBAN_DB=/data/arckanban.db
ENV PYTHONUNBUFFERED=1

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 5000

CMD ["python", "app.py"]
