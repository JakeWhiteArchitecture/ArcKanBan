# Running ArcKanban

ArcKanban is a single-user, local-first app: a Flask backend with all data in one
SQLite file (`arckanban.db`) next to the code. There's no build step and nothing to
compile — you just need Python and the two dependencies.

> **Security note.** The app has no user accounts or login — its only protection is a
> same-origin check on write requests. Treat reaching the app as equivalent to full
> access. That's fine when only *you* (or your own devices) can reach it; it is **not**
> safe to put on the public internet without adding authentication in front of it
> (see *Public access* below).

---

## 1. Install

```bash
pip install -r requirements.txt
```

## 2. Run it properly (Waitress)

`python app.py` starts Flask's *development* server — handy while hacking, but not meant
for everyday use. For real use, run it under **Waitress**, a small pure-Python WSGI
server (no extra system packages, works the same on macOS / Linux / Windows):

```bash
python serve.py
```

That serves on `http://127.0.0.1:5000` — reachable from this machine only. `serve.py`
also creates the database schema on first run, so a fresh checkout just works.

Host and port come from the environment, so you never edit code to change where it listens:

```bash
ARCKANBAN_HOST=0.0.0.0 python serve.py      # all interfaces (LAN + VPN)
ARCKANBAN_PORT=8080     python serve.py      # different port
```

### Keep it running

So you don't have to leave a terminal open:

- **macOS** — a `launchd` LaunchAgent (a small `.plist` in `~/Library/LaunchAgents`).
- **Linux** — a `systemd --user` service: `systemctl --user enable --now arckanban`.
- **Windows** — Task Scheduler, "run at log on".

Each just runs `python /path/to/serve.py` with the environment variables you want.

---

## 2b. Run in a container (Podman / Docker)

If you'd rather not manage a Python environment at all, run it as a container. The repo
ships a `Containerfile` that works with **Podman** (Fedora's default) or Docker. The
database is kept on a named volume, so it **survives the container being rebuilt** after a
`git pull`.

```bash
# from the repo folder — build once:
podman build -t arckanban .

# run it (published to localhost only; data on the arckanban-data volume):
podman run -d --name arckanban \
  -p 127.0.0.1:5000:5000 \
  -v arckanban-data:/data \
  arckanban
```

Open **http://127.0.0.1:5000**. Day-to-day:

```bash
podman stop arckanban        # stop
podman start arckanban       # start again
podman logs -f arckanban     # watch output
```

To update after pulling new code — rebuild and recreate; the volume keeps your data:

```bash
git pull
podman build -t arckanban .
podman rm -f arckanban
podman run -d --name arckanban -p 127.0.0.1:5000:5000 -v arckanban-data:/data arckanban
```

Notes:
- A **named volume** (`arckanban-data`) avoids SELinux hassle. If you'd rather use a host
  folder, add `:Z` so SELinux relabels it — e.g. `-v ./data:/data:Z`.
- Reach it from your phone over the mesh by publishing to your NetBird address instead of
  localhost: `-p 100.x.x.x:5000:5000` (see §3).
- **Auto-start on boot** (Fedora): generate a user service with
  `podman generate systemd --new --name arckanban` (or a Quadlet), enable it with
  `systemctl --user enable …`, and `loginctl enable-linger $USER` so it runs without you
  logged in.
- Everything inside the container is disposable — your data lives only on the volume, so
  back *that* up (see §5).

---

## 3. Private access from your phone / tablet (NetBird / Tailscale)

This is the recommended way to use ArcKanban beyond your desk **without exposing it to the
internet**. A WireGuard mesh VPN (NetBird, optionally self-hosted for full sovereignty)
gives every one of your devices a stable private address; only your devices can reach the
app, and all traffic is encrypted. Because the VPN *is* the security boundary, the app's
lack of built-in auth is not a problem here.

1. Install the NetBird agent on this machine and on each device you want to use.
2. Find this machine's NetBird address (a `100.x.x.x` peer IP, shown in the NetBird app/CLI).
3. Start ArcKanban bound to that address (or to all interfaces):

   ```bash
   ARCKANBAN_HOST=100.x.x.x python serve.py     # mesh only — most private
   # or, simpler:
   ARCKANBAN_HOST=0.0.0.0   python serve.py     # mesh + local network
   ```

4. On your phone/tablet (with NetBird connected) open `http://100.x.x.x:5000`.

Binding to the `100.x.x.x` address keeps it off your local Wi-Fi entirely — reachable
*only* through the mesh. Binding to `0.0.0.0` is easier but also exposes it to anyone on
the same LAN.

---

## 4. Public access (only if you really need it)

If you want it reachable from anywhere on the open internet, put a reverse proxy in front
that terminates HTTPS **and adds authentication** — the app itself has neither.
[Caddy](https://caddyserver.com) is the simplest for a single app (automatic HTTPS + a
one-line password gate); Traefik works too if you already run it.

```caddyfile
# Caddyfile — automatic HTTPS + a basic-auth gate in front of ArcKanban
kanban.example.com {
    basic_auth {
        # generate the hash with: caddy hash-password
        you  $2a$14$your_bcrypt_hash_here
    }
    reverse_proxy 127.0.0.1:5000
}
```

Run ArcKanban on `127.0.0.1:5000` (the default) so it's reachable *only* through the
proxy, never directly. Note the password gate is the **only** thing protecting an app with
no internal accounts — fine as a personal lock, not a substitute for real multi-user auth.

---

## 5. Back up your data

Everything lives in `arckanban.db`. Copy it somewhere safe on a schedule — a consistent
snapshot even while the app is running:

```bash
sqlite3 arckanban.db ".backup '/path/to/backups/arckanban-$(date +%F).db'"
```

A daily `cron` / Task Scheduler job that keeps the last week or two is plenty for a
single-user tool.
