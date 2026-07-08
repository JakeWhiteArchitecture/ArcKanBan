# Running ArcKanban behind Caddy + TinyAuth

ArcKanban serves plain HTTP on port **5000** (Waitress, via the `Dockerfile`). Caddy sits
in front to give it a hostname and automatic HTTPS; [TinyAuth](https://tinyauth.app) sits
in front of *that* to give you a real login page instead of a browser Basic Auth prompt.

> ⚠️ **ArcKanban has no login** — its only protection is a same-origin check on writes.
> Don't expose it beyond your own machine/VPN without TinyAuth (or at least Basic Auth —
> see `DEPLOY.md`) in front of it.

This guide assumes you already run Caddy with Docker Compose. Swap the example names
(`kanban.example.com`, `tinyauth.example.com`) for yours.

## 1. Docker Compose

```yaml
services:
  arckanban:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: arckanban
    restart: unless-stopped
    volumes:
      - arckanban-data:/data        # keeps the SQLite DB across rebuilds
    # No `ports:` — Caddy reaches it over the compose network.

  tinyauth:
    image: ghcr.io/tinyauthapp/tinyauth:v5
    container_name: tinyauth
    restart: unless-stopped
    environment:
      TINYAUTH_APPURL: https://tinyauth.example.com
      TINYAUTH_AUTH_USERS: "you:$$2a$$10$$your_bcrypt_hash_here"   # note the doubled $$
    volumes:
      - tinyauth-data:/data

  caddy:
    image: caddy:2
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config

volumes:
  arckanban-data:
  tinyauth-data:
  caddy-data:
  caddy-config:
```

Generate a bcrypt hash for `TINYAUTH_AUTH_USERS` (e.g. `caddy hash-password`, or whatever
TinyAuth's own docs recommend) and paste the whole `user:$2a$...` line in, doubling every
`$` because it's inside a Compose file.

## 2. Caddyfile

```caddyfile
tinyauth.example.com {
    reverse_proxy tinyauth:3000
}

kanban.example.com {
    forward_auth tinyauth:3000 {
        uri /api/auth/caddy
        copy_headers Remote-User Remote-Email Remote-Name
    }
    reverse_proxy arckanban:5000
}
```

> **Double-check the `forward_auth` path against TinyAuth's current docs before relying on
> it.** I confirmed `TINYAUTH_APPURL` / `TINYAUTH_AUTH_USERS` and the port (3000) from
> TinyAuth's own example, and confirmed the equivalent Traefik path is
> `/api/auth/traefik` — but I couldn't reach tinyauth.app to confirm the exact Caddy path
> (`/api/auth/caddy` above is the analogous guess, not a verified value) while writing
> this. See [tinyauth.app/docs](https://tinyauth.app/docs).

Bring it up:

```bash
docker compose up -d --build
```

Open **https://kanban.example.com** — TinyAuth's login page appears first; once signed in
you're forwarded through to the board.

## 3. Updating

```bash
git pull
docker compose up -d --build     # the arckanban-data volume keeps your data
```

## Notes

- **Keep the Host header** (Caddy forwards it by default). ArcKanban's write protection
  compares the browser's `Origin` to the request host, so stripping/rewriting Host would
  break saving. No other proxy config is needed.
- **HTTPS is automatic** — Caddy requests and renews a Let's Encrypt certificate for any
  domain you give it, as long as it's reachable on port 80/443 for the ACME challenge.
- **Single user by design:** ArcKanban itself doesn't have accounts, so TinyAuth is really
  an all-or-nothing gate (same as Basic Auth) with a nicer login page — everyone who signs
  in shares the same boards. For separate users, run separate ArcKanban + TinyAuth pairs.
