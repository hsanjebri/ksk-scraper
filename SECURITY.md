# Security

How this system protects plant data, what each control is for, and what it
does not cover. Settings are documented in [`.env.example`](.env.example).

## What is being protected

Rework records from the SEBN TN3 plant: car IDs, error codes, timestamps and
repair comments. They leave the plant network in one direction only — a
collector on a plant PC pushes them to the cloud API — and are read back by
signed-in people through the dashboard.

```
plant PC (live-sync.ps1) ──HTTPS + HMAC──▶ API (Railway) ◀──/api proxy── dashboard (Vercel) ◀── browser
                                              ▲                                                  │
                                              └──────────── WebSocket + 60 s ticket ─────────────┘
```

## Controls

### Dashboard users

- **Individual accounts** (`DASHBOARD_USERS`), so access can be revoked per
  person and the log says who signed in. Passwords are stored only as
  **scrypt** hashes; plain passwords are refused at startup. Generate entries
  with `npm run auth:hash-password`.
- **Session cookie**: `HttpOnly`, `Secure`, `SameSite=Strict`, signed with
  `SESSION_SECRET` (32+ characters), 8 hours by default (`SESSION_TTL_HOURS`).
  The dashboard reaches the API through its own origin (`/api`, a Vercel
  rewrite), so the cookie is first-party and JavaScript can never read it.
- **Every data route requires a session**; only the liveness probe, sign-in
  and the collector route are public, and the collector has its own check.
- **Brute force**: 10 failed attempts lock a user for 15 minutes, and sign-in
  is rate-limited to 20 requests per minute per IP.
- **Live socket**: WebSocket transport only, opened with a ticket valid for
  60 seconds, fetched through the authenticated proxy.

### Plant collector

- **HMAC-SHA256 request signing**. The key never travels: each request carries
  a timestamp, a random nonce and `HMAC(key, timestamp.nonce.body)` over the
  exact bytes sent. The server verifies it before reading a single field.
- **Replay protection**: requests older than 5 minutes are refused, and a nonce
  is accepted once.
- **Key storage on the plant PC**: entered once, then kept in `live-sync.key`,
  encrypted by Windows DPAPI for that account and PC. No key is ever written in
  a script.
- **Rotation**: `scripts/ops/rotate-railway-secrets.sh` regenerates all three
  secrets on Railway in one go. Without downtime: `SYNC_SECRET="old,new"`, switch the collector,
  then remove the old key. Replacing the key is also the **kill switch** — the
  collector stops by itself after three refused requests.
- **HTTPS only**: the collector refuses a non-HTTPS server address.
- **Optional IP allowlist** for the collector route (`INGEST_ALLOWED_IPS`).

### Data minimisation

Detail pages name the operator who registered, repaired and released each
unit. The dashboard has no use for them, so the collector **removes operator
numbers on the plant PC, before sending**. The capture tool does the same, and
the collector identifies itself with a neutral label, not the PC name.

### Transport and platform

- Security headers on every response: a deny-all CSP, `nosniff`, no framing,
  HSTS, `no-store` caching, no `X-Powered-By`.
- Rate limiting per IP (`src/security/rate-limit.ts`, no third-party
  dependency); proxy trust is a hop count (`TRUST_PROXY_HOPS`), so the client
  IP cannot be spoofed.
- No CORS by default (`CORS_ORIGINS` to open it deliberately).
- Input validation on query parameters; database access only through
  parameterised TypeORM queries.
- Escaping of scraped text in chart tooltips and CSV exports.
- The container runs as the unprivileged `node` user, without npm.

### Supply chain and CI

Every change runs through [the CI/CD pipeline](.github/workflows/ci.yml):
CodeQL on the code and the workflows, a dependency audit, Trivy on the Docker
image, dependency review on pull requests, and an integration suite that
checks the controls above against a real server and database. Third-party
actions are pinned to commit SHAs; Dependabot proposes upgrades weekly.

## Residual risks

- **Rate limits are in memory**, per instance. Correct for the single Railway
  replica; several replicas need a shared store.
- **Sessions are stateless**: signing out clears the cookie, but a stolen token
  stays valid until it expires. Rotating `SESSION_SECRET` signs everyone out.
- **Dashboard users behind the Vercel proxy share its egress IPs**, so they
  share one rate-limit bucket. Fine for a handful of people.
- **Schema sync is on by default** (`DB_SYNCHRONIZE`) so a fresh deployment
  works. Turn it off once the schema exists and use a database role without
  DDL rights.
- **`-ExecutionPolicy Bypass`** in `live-sync.bat` applies to that one run
  only. IT can sign the script and remove it.

## Reporting a vulnerability

Please report it privately through GitHub's
[security advisories](https://github.com/hsanjebri/ksk-scraper/security/advisories/new)
rather than in a public issue.
