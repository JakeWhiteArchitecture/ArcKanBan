# Running ArcKanban behind Traefik

ArcKanban serves plain HTTP on port **5000** (Waitress, via `serve.py`). Traefik sits in
front to give it a hostname and HTTPS.

> ⚠️ **ArcKanban has no login** — its only protection is a same-origin check on writes. Add
> Traefik **Basic Auth** (below) before exposing it beyond your own machine/VPN.

This guide assumes you **already run Traefik** with the Docker provider, a Let's Encrypt
**certresolver**, and `web` (80) / `websecure` (443) entrypoints. Swap the example names
(`kanban.example.com`, `letsencrypt`, the `traefik` network) for yours.

## 1. Docker Compose (recommended)

Drop this `docker-compose.yml` in the repo root (next to `Containerfile`):

```yaml
services:
  arckanban:
    build:
      context: .
      dockerfile: Containerfile     # the repo ships a Containerfile, not a Dockerfile
    container_name: arckanban
    restart: unless-stopped
    networks: [traefik]             # the network Traefik watches
    volumes:
      - arckanban-data:/data        # keeps the SQLite DB across rebuilds
    # No `ports:` — Traefik reaches it over the docker network.
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.arckanban.rule=Host(`kanban.example.com`)
      - traefik.http.routers.arckanban.entrypoints=websecure
      - traefik.http.routers.arckanban.tls.certresolver=letsencrypt
      - traefik.http.services.arckanban.loadbalancer.server.port=5000
      # --- Basic Auth — don't skip it, the app has no login of its own ---
      - traefik.http.routers.arckanban.middlewares=arckanban-auth
      - traefik.http.middlewares.arckanban-auth.basicauth.users=USER:HASH

volumes:
  arckanban-data:

networks:
  traefik:
    external: true
```

Make the `USER:HASH` for Basic Auth and paste it into the last label:

```bash
htpasswd -nB jake        # prompts for a password; copy the whole "jake:$2y$..." line
```

In a Compose file you must **double every `$`** in that hash (`$` → `$$`), or it won't parse.

Bring it up:

```bash
docker compose up -d --build
```

Open **https://kanban.example.com** and log in with your Basic Auth user. Done.

## 2. Updating

```bash
git pull
docker compose up -d --build     # the arckanban-data volume keeps your data
```

## 3. Not using Docker? (Traefik file provider)

If you run ArcKanban directly (`ARCKANBAN_HOST=0.0.0.0 python serve.py` — see `DEPLOY.md`)
and want Traefik to route to it, add this to your Traefik **dynamic** config file:

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
          - url: "http://127.0.0.1:5000"    # where serve.py is listening
  middlewares:
    arckanban-auth:
      basicAuth:
        users:
          - "USER:HASH"                     # from `htpasswd -nB` (no $ doubling here)
```

## Notes

- **Keep the Host header** (Traefik forwards it by default). ArcKanban's write protection
  compares the browser's `Origin` to the request host, so stripping/rewriting Host would
  break saving. No other proxy config is needed.
- **HTTPS** comes from the `tls`/`certresolver` lines. Drop them only if TLS is terminated
  elsewhere.
- **Single user by design:** Basic Auth is the gate — everyone who logs in shares the same
  boards. For separate users, run separate instances (each with its own `/data` volume and
  hostname).
