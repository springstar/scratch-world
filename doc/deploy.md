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

## Production Build

### Backend

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
    location ~ ^/(scenes|interact|chat|splat|uploads|realtime|health) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;   # allow long Marble generation polls
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

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
