"""Seed a fresh ArcKanban database with realistic demo data.

Useful for screenshots, demos or kicking the tyres without entering data by hand.
Points the app at the given DB file, creates the schema, then drives the normal
JSON API (so the data is exactly what the app itself would produce).

    python tools/seed_demo.py [db_path]      # default: docs/img/demo.db

`seed(db_path)` is importable (see tools/screenshots.py) and returns a little dict
describing the showcase project to open.
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A  # noqa: E402


def _post(client, url, payload):
    r = client.post(url, data=json.dumps(payload), content_type="application/json")
    return r.get_json() or {}


def seed(db_path):
    """Create `db_path` (overwriting) and fill it with demo projects. Returns
    {"showcase_uid", "showcase_stage"} for the project worth screenshotting."""
    A.DB_PATH = db_path
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    if os.path.exists(db_path):
        os.remove(db_path)
    A.init_db()
    client = A.app.test_client()
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row

    def project(number, name, current_stage=0, archived=0):
        client.post("/projects", data={"number": number, "name": name, "template": ""})
        row = db.execute("SELECT * FROM projects ORDER BY id DESC LIMIT 1").fetchone()
        db.execute("UPDATE projects SET current_stage=?, archived=? WHERE id=?",
                   (current_stage, archived, row["id"]))
        db.commit()
        return row["id"], row["uid"]

    def task(pid, stage, title, type="recommended", status="todo", urgent=False, awaiting=""):
        t = _post(client, "/api/projects/%d/tasks" % pid,
                  {"stage": stage, "substage": 0, "title": title, "type": type, "status": status})["task"]
        upd = {}
        if urgent:
            upd["urgent"] = True
        if awaiting:
            upd["awaiting_on"] = awaiting
        if upd:
            _post(client, "/api/tasks/%d" % t["id"], upd)
        return t["id"]

    def decision(pid, stage, title, options, outcome=None, by="", rationale=""):
        did = task(pid, stage, title, type="decision", status="todo", awaiting=by)
        for o in options:
            _post(client, "/api/tasks/%d/options" % did, {"text": o})
        if outcome:
            if by:
                _post(client, "/api/tasks/%d" % did, {"awaiting_on": by})
            _post(client, "/api/tasks/%d/confirm" % did, {"text": outcome})
            if rationale:
                _post(client, "/api/tasks/%d" % did, {"rationale": rationale})
        return did

    # --- showcase project, focused on RIBA Stage 3 (Spatial Coordination) ---
    pid, uid = project("24-014", "14 Elm Road — rear extension", current_stage=3)
    task(pid, 3, "Coordinate structure with M&E", "process", "inprogress")
    task(pid, 3, "Party wall award", "statutory", "awaiting", awaiting="Surveyor")
    task(pid, 3, "Resolve ridge height with planning", "statutory", "todo", urgent=True)
    task(pid, 3, "Develop detailed floor plans", "recommended", "todo")
    task(pid, 3, "1:20 bathroom layout", "recommended", "upcoming")
    task(pid, 3, "Issue Stage 3 coordination set", "process", "backlog")
    task(pid, 3, "Window schedule v1", "recommended", "done")
    task(pid, 2, "Concept design sign-off", "process", "done")

    decision(pid, 3, "Feature wall colour", ["Red", "Blue", "Green"], outcome="Red", by="Client",
             rationale="Matches the existing brick; confirmed with the client on site.")
    decision(pid, 3, "Rooflight specification", ["VELUX", "Rooflight Co.", "Bespoke"], outcome="VELUX",
             by="Architect", rationale="Best lead time within budget.")
    decision(pid, 3, "Retain or replace the rear gable", ["Retain", "Replace"], by="Structural Engineer")
    decision(pid, 4, "External cladding system", ["Brick slip", "Render", "Timber"], by="Client")

    # --- a second live project ---
    p2, _ = project("24-008", "The Maltings — loft conversion", current_stage=1)
    task(p2, 1, "Measured survey", "process", "done")
    task(p2, 1, "Feasibility options", "recommended", "inprogress")
    task(p2, 1, "Confirm budget with client", "process", "awaiting", awaiting="Client")

    # --- an archived project ---
    pa, _ = project("23-102", "Old Dairy — barn conversion", current_stage=7, archived=1)
    task(pa, 7, "Final handover pack", "process", "done")

    db.close()
    return {"showcase_uid": uid, "showcase_stage": 3}


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join("docs", "img", "demo.db")
    info = seed(path)
    print("Seeded demo database at %s" % path)
    print("Showcase project: /projects/%s  (stage %d)" % (info["showcase_uid"], info["showcase_stage"]))
