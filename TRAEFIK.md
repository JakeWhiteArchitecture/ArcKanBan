# Running ArcKanban behind Traefik

ArcKanban serves plain HTTP on port **5000** (Waitress, via `serve.py`); Traefik sits in
front for a hostname + HTTPS. The repo is **Podman-first** (see `Containerfile` / `DEPLOY.md`),
so this guide is too — there's no benefit to Docker for this. (If you do run Docker, the
same labels in §2b work via the normal Docker socket.)

> ⚠️ **ArcKanban has no login** — only a same-origin check on writes. Add Traefik
> **Basic Auth** (below) before exposing it beyond your own machine/VPN.

Examples use `kanban.example.com`, a `letsencrypt` certresolver and `web`/`websecure`
entrypoints — swap them for yours.

## 1. Run ArcKanban (rootless Podman)

Exactly as in `DEPLOY.md` — published to localhost only, data on a named volume:

```bash
podman build -t arckanban .
podman run -d --name arckanban --restart=unless-stopped \
  -p 127.0.0.1:5000:5000 -v arckanban-data:/data arckanban
```

## 2a. Point Traefik at it — file provider (simplest)

Best when Traefik runs on the host (or anything that can reach `127.0.0.1:5000`). Add to
your Traefik **dynamic** config file:

```yaml
http:
  routers:
    arckanban:
      rule: "Host(`kanban.example.com`)"
      entryPoints: [websecure]
      tls: { certResolver: letsencrypt }
      service: arckanban
      middlewares: [arckanban-auth]
  services:
    arckanban:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:5000"
  middlewares:
    arckanban-auth:
      basicAuth:
        users:
          - "USER:HASH"          # from: htpasswd -nB jake
```

No socket, no labels — Traefik just proxies to the port. (If Traefik is itself a Podman
container, run it with `--network=host`, or put both on one network and use `http://arckanban:5000`.)

## 2b. Or let Traefik auto-discover it — labels via the Podman socket

If you'd rather Traefik find the container by labels (the "Docker-style" way), Podman exposes
a Docker-compatible API. Enable the socket once:

```bash
systemctl --user enable --now podman.socket    # → /run/user/$(id -u)/podman/podman.sock
```

Point Traefik's **docker provider** at it (static config):

```yaml
providers:
  docker:
    endpoint: "unix:///run/user/1000/podman/podman.sock"   # use your own $(id -u)
    exposedByDefault: false
    network: traefik
```

Then put Traefik and ArcKanban on one Podman network and run it with the labels (no `-p` —
Traefik reaches it over the network):

```bash
podman network create traefik     # once
podman run -d --name arckanban --restart=unless-stopped \
  --network traefik -v arckanban-data:/data \
  --label traefik.enable=true \
  --label 'traefik.http.routers.arckanban.rule=Host(`kanban.example.com`)' \
  --label traefik.http.routers.arckanban.entrypoints=websecure \
  --label traefik.http.routers.arckanban.tls.certresolver=letsencrypt \
  --label traefik.http.services.arckanban.loadbalancer.server.port=5000 \
  --label traefik.http.routers.arckanban.middlewares=arckanban-auth \
  --label 'traefik.http.middlewares.arckanban-auth.basicauth.users=USER:HASH' \
  arckanban
```

## Basic Auth user

```bash
htpasswd -nB jake      # prompts for a password; use the whole "jake:$2y$..." line as USER:HASH
```

`$`-handling for the hash: paste it **as-is** in the Traefik file YAML (§2a); keep it
**single-quoted** in `--label` (as shown, so the shell leaves `$` alone); only double each
`$`→`$$` if you ever put it in a **compose** file.

## Updating

```bash
git pull
podman build -t arckanban .
podman rm -f arckanban
# re-run the same `podman run …` from §1 (file provider) or §2b — the arckanban-data
# volume keeps your database.
```

## Notes

- **Keep the Host header** (Traefik forwards it by default): ArcKanban's write check compares
  the browser's `Origin` to the request host, so don't rewrite Host.
- **HTTPS** comes from the `tls`/`certresolver` lines; drop them if TLS is terminated elsewhere.
- **Single user by design** — Basic Auth is the gate; everyone who logs in shares the boards.
- To keep it running across reboots, prefer a **Quadlet** / `systemd --user` unit
  (`podman generate systemd` or a `.container` file) — see `DEPLOY.md`.
