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

## Optional: real login with Authentik (SSO)

Basic Auth is a shared password with no UI. If you want **proper accounts, a login page,
optional MFA, and one sign-on across several internal apps**, put
[authentik](https://goauthentik.io) in front via Traefik **forward auth** instead. It's
heavier — authentik's compose runs **PostgreSQL + Redis + server + worker** — so it earns its
keep when you'll protect more than just this board. ArcKanban itself is unchanged: authentik
gates *access*; the board stays single-user inside.

> Forward-auth uses session cookies, so run this over **HTTPS** (self-signed / internal-CA is
> fine — see above). Authentik, ArcKanban and Traefik must share a network so Traefik can reach
> both the app and authentik's outpost.

**1. Stand up authentik** (download its compose, set two secrets, start it):

```bash
curl -O https://goauthentik.io/docker-compose.yml          # podman or docker compose both work
printf 'PG_PASS=%s\nAUTHENTIK_SECRET_KEY=%s\n' \
  "$(openssl rand -base64 36 | tr -d '\n')" \
  "$(openssl rand -base64 60 | tr -d '\n')" > .env
docker compose up -d                                       # → postgresql, redis, server, worker
```

Finish setup at `http://<host>:9000/if/flow/initial-setup/`. Full current steps:
<https://docs.goauthentik.io/install-config/install/docker-compose/>.

**2. In the authentik UI**, create:
- a **Proxy Provider** in **Forward auth (single application)** mode, *External host* = `https://kanban.example.com`;
- an **Application** linked to it; and
- assign that application to the **authentik Embedded Outpost** (Outposts → Embedded → add it).

(Guide: <https://docs.goauthentik.io/add-secure-apps/providers/proxy/server_traefik>.)

**3. Traefik** — a forward-auth middleware, a router so the outpost paths reach authentik, and
the middleware applied to ArcKanban's router (dynamic config):

```yaml
http:
  routers:
    arckanban:
      rule: "Host(`kanban.example.com`)"
      entryPoints: [websecure]
      tls: {}
      service: arckanban
      middlewares: [authentik]                 # ← the gate
    arckanban-outpost:                          # lets authentik's login/callback paths through
      rule: "Host(`kanban.example.com`) && PathPrefix(`/outpost.goauthentik.io/`)"
      entryPoints: [websecure]
      tls: {}
      service: authentik
  services:
    arckanban:
      loadBalancer: { servers: [{ url: "http://arckanban:5000" }] }
    authentik:
      loadBalancer: { servers: [{ url: "http://authentik-server:9000" }] }
  middlewares:
    authentik:
      forwardAuth:
        address: "http://authentik-server:9000/outpost.goauthentik.io/auth/traefik"
        trustForwardHeader: true
        authResponseHeaders: [X-authentik-username, X-authentik-email, X-authentik-groups, X-authentik-name, X-authentik-uid]
```

Now visiting the board redirects to the authentik login; after signing in, Traefik forwards
you through. (ArcKanban ignores the `X-authentik-*` headers — they're there only if you ever
want them.) Drop the `arckanban-auth` Basic Auth middleware when you switch to this.

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
