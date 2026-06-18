#!/usr/bin/env python3
"""Production entrypoint for ArcKanban.

Runs the app under Waitress (a small, pure-Python WSGI server) instead of
Flask's development server. Unlike `python app.py`, this also works when the
app is imported by a WSGI host, and it ensures the database schema exists
before the first request.

Usage:
    python serve.py                      # serve on 127.0.0.1:5000 (this machine only)
    ARCKANBAN_HOST=0.0.0.0 python serve.py   # all interfaces (LAN + VPN)
    ARCKANBAN_HOST=100.x.x.x python serve.py  # bind to one address, e.g. a NetBird peer IP
    ARCKANBAN_PORT=8080 python serve.py      # different port

The host/port are read from the environment so you never have to edit code to
change where it listens.
"""
import os

from waitress import serve

from app import app, init_db

HOST = os.environ.get("ARCKANBAN_HOST", "127.0.0.1")
PORT = int(os.environ.get("ARCKANBAN_PORT", "5000"))

if __name__ == "__main__":
    init_db()  # idempotent: creates tables on first run, applies additive migrations otherwise
    print(f"ArcKanban serving on http://{HOST}:{PORT}  (Ctrl+C to stop)")
    serve(app, host=HOST, port=PORT)
