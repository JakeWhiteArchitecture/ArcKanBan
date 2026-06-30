# Running ArcKanban behind Traefik (intranet)

ArcKanban serves plain HTTP on port **5000** (Waitress, via `serve.py`); Traefik sits in
front to give it a hostname. The repo is **Podman-first** (`Containerfile` / `DEPLOY.md`), so
this guide is too — there's no benefit to Docker here.

**What ArcKanban does and doesn't protect:** it has a same-origin write check (CSRF defence)
but **no login and no TLS**. On an intranet its real protection is staying on your private
network. You generally **don't need Let's Encrypt** — see *Do you need HTTPS?* below.

Examples use `kanban.example.com` and the `web` (HTTP) entrypoint — swap for yours.

## 1. Run ArcKanban (rootless Podman)

As in `DEPLOY.md` — published to localhost only, data on a named volume:

```bash
podman build -t arckanban .
podman run -d --name arckanban --restart=unless-stopped \
  -p 127.0.0.1:5000:5000 -v arckanban-data:/data arckanban
```

## 2a. Point Traefik at it — file provider (simplest)

Best when Traefik runs on the host (or anything that can reach `127.0.0.1:5000`). Add to your
Traefik **dynamic** config file:

```yaml
http:
  routers:
    arckanban:
      rule: "Host(`kanban.example.com`)"
      entryPoints: [web]            # plain HTTP — fine on a trusted LAN
      service: arckanban
      # middlewares: [arckanban-auth]   # uncomment to require a password (see below)
  services:
    arckanban:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:5000"
  # middlewares:
  #   arckanban-auth:
  #     basicAuth:
  #       users: ["USER:HASH"]      # from: htpasswd -nB jake
```

No socket, no labels — Traefik just proxies to the port. (If Traefik is itself a Podman
container, run it with `--network=host`, or put both on one network and use `http://arckanban:5000`.)

## 2b. Or let Traefik auto-discover it — labels via the Podman socket

Podman exposes a Docker-compatible API, so Traefik can find the container by labels. Enable
the socket once:

```bash
systemctl --user enable --now podman.socket    # → /run/user/$(id -u)/podman/podman.sock
```

Point Traefik's **docker provider** at it (static config), then run ArcKanban on a shared
Podman network with labels (no `-p` — Traefik reaches it over the network):

```bash
podman network create traefik     # once
podman run -d --name arckanban --restart=unless-stopped \
  --network traefik -v arckanban-data:/data \
  --label traefik.enable=true \
  --label 'traefik.http.routers.arckanban.rule=Host(`kanban.example.com`)' \
  --label traefik.http.routers.arckanban.entrypoints=web \
  --label traefik.http.services.arckanban.loadbalancer.server.port=5000 \
  arckanban
```

```yaml
# traefik static config
providers:
  docker:
    endpoint: "unix:///run/user/1000/podman/podman.sock"   # use your own $(id -u)
    exposedByDefault: false
    network: traefik
```

## Do you need HTTPS?

On an intranet, usually not. Pick what fits:

- **Trust the LAN → plain HTTP.** Simplest. Use the `web` entrypoint as above. Reasonable for
  a single-practice internal network.
- **Want a password → add TLS too.** Basic Auth over plain HTTP sends the password in the
  clear on every request, so if you turn on auth, encrypt the connection. A **self-signed /
  internal-CA cert** is plenty for intranet — no Let's Encrypt needed:

  ```yaml
  # dynamic config: serve your own cert, switch the router to the websecure entrypoint
  http:
    routers:
      arckanban:
        entryPoints: [websecure]
        tls: {}                    # {} = Traefik's default cert (self-signed; browser warning)
  tls:
    certificates:
      - certFile: /certs/kanban.crt   # or an internal-CA cert your machines already trust
        keyFile:  /certs/kanban.key
  ```

- **Let's Encrypt** only really works for an internal host via the **DNS-01** challenge (your
  domain's DNS must be publicly managed). HTTP-01 won't work — the box isn't reachable from the
  internet. Usually overkill for an intranet.

### Basic Auth user (if you enable it)

```bash
htpasswd -nB jake      # prompts for a password; use the whole "jake:$2y$..." line as USER:HASH
```

Paste it **as-is** in the Traefik file YAML; keep it **single-quoted** in a `--label`; only
double each `$`→`$$` in a **compose** file.

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
- **Single user by design** — there are no separate accounts; everyone who can reach it (or
  passes Basic Auth, if set) shares the same boards.
- To keep it running across reboots, prefer a **Quadlet** / `systemd --user` unit — see `DEPLOY.md`.
