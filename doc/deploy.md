# Deployment Guide

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10
- (Production) PostgreSQL database, or SQLite for single-node deployments

---

## Local Development

### 1. Install dependencies

```bash
npm install
cd viewer && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env   # or create .env manually
```

Minimum `.env` for local dev with stub provider (no API keys needed):

```env
CHANNEL=stdin
SCENE_PROVIDER=stub
DATABASE_URL=sqlite:./dev.db
ANTHROPIC_API_KEY=<your-key>
```

### 3. Start services

Two processes must run concurrently:

```bash
# Terminal 1 — backend (bot + viewer API on port 3001)
npm run dev

# Terminal 2 — viewer frontend (Vite dev server on port 5173)
cd viewer && npm run dev
```

Open `http://localhost:5173` in a browser.

---

## Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `CHANNEL` | `telegram` | Yes | `telegram` or `stdin` |
| `TELEGRAM_BOT_TOKEN` | — | When `CHANNEL=telegram` | Telegram bot token from @BotFather |
| `ANTHROPIC_API_KEY` | — | Yes | Claude API key |
| `ANTHROPIC_BASE_URL` | — | No | Override Anthropic endpoint (proxy) |
| `SCENE_PROVIDER` | `stub` | No | `marble`, `llm`, or `stub` |
| `MARBLE_API_KEY` | — | When `SCENE_PROVIDER=marble` | WorldLabs API key |
| `MARBLE_API_URL` | — | No | Custom Marble endpoint |
| `SPZ_MODE` | `proxy` | No | Marble splat serving strategy — see [SPZ Auth](#spz-auth) |
| `DATABASE_URL` | `sqlite:./dev.db` | No | `sqlite:<path>` or `postgres://...` |
| `VIEWER_API_PORT` | `3001` | No | Backend HTTP/WS listen port |
| `VIEWER_BASE_URL` | `http://localhost:3001` | No | Public URL used in outbound scene links |
| `AGENT_MAX_TURNS` | `20` | No | Max conversation turns kept in agent context |

---

## SPZ Auth

> **Critical**: Marble's Gaussian splat files (`spz_urls[]`) require the `WLT-Api-Key`
> header. This key must never be sent to the browser. Two modes are available.

### `SPZ_MODE=proxy` (default)

The backend route `GET /splat/:sceneId` fetches the SPZ from Marble's CDN with the
API key added server-side, then streams the binary to the browser.

- No extra disk space needed.
- Each page load re-fetches from Marble's CDN. If the CDN URL expires, the splat is
  unavailable until the world is re-generated.

### `SPZ_MODE=local`

At generation time the backend downloads `spz_urls[0]` and saves it to
`uploads/splats/<worldId>.spz`. The static file server at `/uploads/*` serves it
directly without any auth header.

- Survives Marble CDN URL expiry.
- Consumes local disk space (typical SPZ file: 50–200 MB per scene).
- Automatically falls back to `proxy` mode if the download fails at generation time.

**Switch in `.env`:**

```env
# Default — no disk usage, but CDN-dependent
SPZ_MODE=proxy

# Recommended for production — cache locally at generation time
SPZ_MODE=local
```

---

## Docker Deployment

### Prerequisites

- Docker >= 24
- Docker Compose v2 (`docker compose` command)

### Quick start

```bash
# 1. Copy and fill in secrets
cp .env.example .env
# Set at minimum: ANTHROPIC_API_KEY, POSTGRES_PASSWORD

# 2. Build and start
docker compose up -d

# 3. Verify
curl http://localhost:3001/health   # → {"ok":true}
```

The stack starts two services:

| Service | Image | Port |
|---------|-------|------|
| `postgres` | postgres:16-alpine | internal only |
| `backend` | built from `Dockerfile` | 3001 |

`postgres` uses a named volume (`postgres_data`) for persistence. `uploads` is also a named volume — bind-mount it to a host path if you need direct access.

### Environment variables for docker compose

Create a `.env` file at the project root (same directory as `docker-compose.yml`):

```env
POSTGRES_PASSWORD=change_me

ANTHROPIC_API_KEY=sk-ant-...

# Optional — leave blank to use stub provider
MARBLE_API_KEY=
MARBLE_API_URL=

CHANNEL=stdin                        # or telegram
TELEGRAM_BOT_TOKEN=

SCENE_PROVIDER=stub                  # or marble / llm
VIEWER_BASE_URL=http://localhost:3001
```

`docker compose` automatically reads `.env` from the working directory and substitutes `${VAR}` in `docker-compose.yml`.

### Useful commands

```bash
docker compose up -d            # start in background
docker compose logs -f backend  # stream backend logs
docker compose down             # stop (data volumes preserved)
docker compose down -v          # stop AND delete volumes (destructive)
docker compose build --no-cache # force full rebuild
```

### Serving the viewer in Docker

The `Dockerfile` builds the Vite viewer and copies `viewer/dist/` to `/app/viewer/dist` in the runtime image. The backend's static file middleware serves it when a request hits `/` or any path not claimed by the API.

If you deploy behind a reverse proxy (nginx, Caddy), point static asset requests at the container and API requests at port 3001 — see the Nginx example below.

---

## CI/CD (GitHub Actions)

The workflow lives at `.github/workflows/ci.yml` and runs on every push and pull request to `master`/`main`.

### What it does

1. Checks out code
2. Sets up Node.js 22 with npm cache
3. Installs backend deps (`npm ci`)
4. Installs viewer deps (`npm ci --prefix viewer`)
5. Runs `npm run check` — biome lint + TypeScript type check
6. Runs `npm test` — vitest test suite (157 tests)

### Branch protection (recommended)

In GitHub → Settings → Branches → Add branch ruleset for `master`:
- Require status checks to pass: `check-and-test`
- Require branches to be up to date before merging

### Adding secrets for CI

If you ever add tests that require real API keys, store them in GitHub → Settings → Secrets and variables → Actions. Reference them in the workflow as `${{ secrets.ANTHROPIC_API_KEY }}`. Current tests use stubs and require no secrets.

---

## Production Build

```bash
npm run build          # compiles TypeScript → dist/
node dist/index.js     # run compiled output
```

### Viewer (static files)

```bash
cd viewer
npm run build          # outputs to viewer/dist/
```

Serve `viewer/dist/` with any static file server (nginx, Caddy, Vercel, etc.).
Point the backend proxy config so the viewer's `/scenes`, `/interact`, `/chat`,
`/splat`, `/uploads`, and `/realtime` paths reach the backend server.

---

## Production Configuration Example

```env
# Channel
CHANNEL=telegram
TELEGRAM_BOT_TOKEN=<token>

# LLM
ANTHROPIC_API_KEY=<key>

# Scene generation
SCENE_PROVIDER=marble
MARBLE_API_KEY=<key>
SPZ_MODE=local

# Storage (PostgreSQL)
DATABASE_URL=postgres://user:password@db-host:5432/scratch_world

# URLs
VIEWER_API_PORT=3001
VIEWER_BASE_URL=https://your-domain.com
```

---

## Nginx Reverse Proxy (example)

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    # Viewer static files
    root /srv/scratch-world/viewer/dist;
    index index.html;

    # API + WebSocket proxy
    location ~ ^/(scenes|interact|npc-interact|npc-greet|chat|splat|collider|gltf-proxy|confirm-position|user-assets|uploads|realtime|health|debug|screenshots|generators) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;   # allow long Marble generation polls
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> The `X-Forwarded-For` header is required for the in-process rate limiter
> (`/chat`: 20 req/min, `/interact`: 30 req/min) to correctly identify clients.
> Without it, all traffic appears to come from `127.0.0.1` and the limits are
> shared across all users.

---

## Database Setup

### SQLite (single-node)

No setup needed. The file is created automatically at the path specified by
`DATABASE_URL=sqlite:./dev.db`. Schema migrations run on startup.

### PostgreSQL (production)

Set `DATABASE_URL=postgres://...`. Tables are created automatically on first startup
if they do not exist.

To back up: `pg_dump scratch_world > backup.sql`

---

## Uploaded Files

The backend stores files under `<projectRoot>/uploads/`:

```
uploads/
├── panoramas/    ← equirectangular skybox images (POST /scenes/:id/panorama)
└── splats/       ← locally-cached SPZ files (SPZ_MODE=local only)
```

Ensure this directory is on a persistent volume in containerised deployments
(e.g. a Docker bind mount or a persistent disk in Kubernetes).

---

## Health Check

```bash
curl http://localhost:3001/health
# → {"ok":true}
```

---

## Related Documents

- `doc/CODEMAP.md` — Architecture overview, all env vars, SPZ auth details
- `doc/architecture.md` — System design
- `CLAUDE.md` — Development conventions
