"""Generate ArcKanban screenshots into docs/img/.

Boots the app with demo data (see seed_demo.py) on a local port and drives a
headless Chromium to capture the main views. Needs Playwright + its browser:

    pip install playwright
    playwright install chromium
    python tools/screenshots.py

Writes docs/img/home.png, board.png and decisions.png.
"""
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)

import app as A  # noqa: E402
from seed_demo import seed  # noqa: E402

OUT = os.path.join(ROOT, "docs", "img")
HOST, PORT = "127.0.0.1", 5055


def main():
    os.makedirs(OUT, exist_ok=True)
    info = seed(os.path.join(OUT, "demo.db"))   # also points A.DB_PATH at the demo db

    from werkzeug.serving import make_server
    server = make_server(HOST, PORT, A.app)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    time.sleep(0.6)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Playwright missing. Run:  pip install playwright && playwright install chromium")

    base = "http://%s:%d" % (HOST, PORT)
    shots = [
        ("home", base + "/", True),
        ("board", "%s/projects/%s?stage=%d" % (base, info["showcase_uid"], info["showcase_stage"]), False),
        ("decisions", "%s/projects/%s/decisions" % (base, info["showcase_uid"]), True),
    ]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
            for name, url, full in shots:
                page.goto(url, wait_until="networkidle")
                page.wait_for_timeout(800)   # let fonts + the drifting background settle
                path = os.path.join(OUT, name + ".png")
                page.screenshot(path=path, full_page=full)
                print("wrote", os.path.relpath(path, ROOT))
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
