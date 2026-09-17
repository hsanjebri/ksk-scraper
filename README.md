<p align="center">
  <img src="dashboard/public/sebn-mercedes-banner.png" alt="SEBN TN03 | Mercedes-Benz" width="480" />
</p>

# SEBN TN3 — Rework Quality Dashboard

<p align="center">
  <img src="dashboard/public/rework-banner.png" alt="Rework Analysis — SEBN TN03 Mercedes Project" width="720" />
</p>

Live quality dashboard for the SEBN TN3 rework zone (Mercedes-Benz programme).

A NestJS service reads the plant's rework application at
`http://rework.jenapp0001.sebn.com` (the "SEBN Standard Rework System", a
legacy PHP app), stores every rework record in a local database, and pushes new
records and closures to a React dashboard over WebSockets.

Everything runs on one PC inside the SEBN network: `npm install`, `npm start`.
No Docker, no database server to install.

---

## What state is it in

Verified end to end against **pages captured from the live site** on
2026-09-17 (5,939 list rows, 2 detail pages) replayed by a local server that
imitates the real one:

| Check | Result |
| --- | --- |
| Unit tests | 113 passing (9 test suites) |
| Full history sync, live mode, 5,939 real records | 107 s, 0 failures |
| Real record MCM #3059 (closed) | every field matches the site, incl. 7 min and week 2026-W38 |
| Real record MAM #2944 (open) | every field matches the site |
| Accented French comments, undeclared charset | 260 accented comments, 0 corrupted |
| New record on the site → `record.new` on the dashboard | 3.5 s |
| Repair → quality control → `record.closed` / `record.updated` | pushed, once each |
| Live cloud bridge | Outbound HTTPS push from plant PC to Railway + Vercel |

Not yet proven: detail-page layouts other than the two captured ones (see
[Known limits](#known-limits)).

---

## Quick start (no network needed)

```bash
npm install
cp .env.example .env          # defaults to SCRAPER_MODE=mock
npm run build && npm start    # http://localhost:3000/records

cd dashboard
npm install
npm run dev                   # http://localhost:5173
```

Mock mode generates data shaped like the real thing (French part names, A/B
shifts, team error producers, the measured error-code distribution), so every
chart is exercised without touching the plant server.

---

## Running against the real rework site

On a PC connected to the SEBN network:

```bash
npm install
cp .env.example .env
```

Then in `.env`:

```ini
SCRAPER_MODE=live
SITE_BASE_URL=http://rework.jenapp0001.sebn.com
```

**1. Check the connection first** — this writes nothing to the database:

```bash
npm run scrape:probe
```

It performs one search and one detail fetch and prints what it parsed. Only
continue if it reports success.

**2. Start it:**

```bash
npm run build && npm start
```

**3. Watch the first sync.** The list pages are the site's entire history, so
all ~6,000 records are stored within seconds — but each one needs its detail
page, fetched at a deliberately polite pace (250 per cycle, 150 ms apart).
Records appear on the dashboard as their detail page arrives, and the top bar
shows a progress bar until it is done (a few minutes). Progress is also visible
at `http://localhost:3000/records/status`.

The dashboard reads the backend through `VITE_API_URL`; for another PC on the
same network, point it at `http://<this-pc>:3000`.

---

## Hosting it online while the data stays inside the plant

The rework server has no route from the internet, so a cloud server can never
reach it. The bridge works the other way round: a script on a PC **inside** the
plant reads the pages and pushes them out.

```
SEBN network (a plant PC)                     Internet
┌───────────────────────────────┐          ┌────────────────────────────┐
│ rework.jenapp0001.sebn.com    │          │ Railway: this backend      │
│          ▲ reads pages        │          │  SCRAPER_MODE=relay        │
│          │                    │  HTTPS   │  + PostgreSQL              │
│ live-sync.bat (PowerShell) ───┼─────────►│  POST /api/scraper/ingest  │
│  double-click, leave open     │  pushes  │            │ WebSocket     │
└───────────────────────────────┘          │ Vercel: dashboard ◄────────┘
                                           └────────────────────────────┘
```

The agent is deliberately dumb: it posts the **raw bytes** of each page and
asks what to fetch next. All parsing, merging, charset detection and
throttling stay on the server, in the code tested against the captured pages —
so the cloud deployment and a direct local one cannot drift apart.

**On the server (Railway):**

```ini
SCRAPER_MODE=relay
SYNC_SECRET=<a long random string>
# DATABASE_URL is injected by the Postgres plugin; TLS is handled automatically
```

Generate the secret with
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

**On the plant PC:** send `live-sync.zip` (in the repo root). Mohamed puts the
same secret in `live-sync.bat`, double-clicks it, and leaves the window open.
Nothing is installed, no admin rights, outbound HTTPS only — nothing inside the
network is exposed.

**Loading the real history first,** so the dashboard is not empty before the
agent has run:

```bash
npm run seed:captured            # reads ./captured/captured into the configured DB
```

Point `.env` at the cloud database (`DATABASE_URL=...`, `DB_TYPE=postgres`) to
seed Railway from your laptop. It goes through the same ingest path the agent
uses. Records without a detail page stay hidden until the agent fetches them —
the first run takes 20–30 minutes for ~6,000 records, so **start the agent well
before any demo**.

**Deployment checklist**

1. Railway → Variables: `SCRAPER_MODE=relay`, `SYNC_SECRET=<random>`. Leaving
   `SCRAPER_MODE` unset means **mock**, and the server seeds fake records into
   the database on first boot.
2. If that already happened, clear them before real data arrives:
   `npm run db:clear-mock` (counts them) then `npm run db:clear-mock -- --yes`.
   The server also logs a loud warning at startup when a live or relay database
   still holds mock-looking records.
3. Vercel → `VITE_API_URL=https://<your-app>.up.railway.app`, then redeploy.
4. `npm run seed:captured` against the cloud database for the real history.
5. Send `live-sync.zip` to the plant PC and have the agent started.
6. Check `GET /records/status`: `mode: "relay"`, an `agent` block with a recent
   `lastSeenAt`, and `counts.pending` falling.

Security notes worth keeping in mind:

- The ingest endpoints **write** the data the dashboard reports and sit on a
  public URL. They fail closed: with no `SYNC_SECRET` set, every push is
  rejected, and requests are refused unless the secret matches exactly.
- Real plant data (CarIDs, defect comments, team names) leaves the SEBN
  network to a third-party host. That is a data-governance decision, not a
  technical one — get it approved by whoever owns the rework application.

## How it works

```
rework.jenapp0001.sebn.com
   │  GET /main.php                       session cookie
   │  POST /Szczegol.php?AK=1             the results list (full history, ~700 KB/model)
   │  GET /Szczegol.php?numer=N&model=M   one detail page
   ▼
LiveHttpSource ──▶ site-parsers.ts ──▶ merge.ts ──▶ SQLite (TypeORM)
   (HTTP only)      (pure parsing)      (pure rules)      │
                                                          ▼
                                          Socket.io ──▶ React dashboard
```

Two scheduled jobs, mirroring the relay already running in the plant:

1. **List scan** (every 60 s) — downloads each model's list page and stores rows
   it has not seen. A few new rows get their detail page immediately, so they
   appear live; a large batch (first run, or catching up after downtime) is
   stored list-only and handed to job 2.
2. **Detail cycle** (every 30 s) — fetches detail pages in priority order:
   records that have not finished yet first, then the backlog newest-first,
   then long-unfinished stragglers.

Design rules worth knowing before changing anything:

- **The list row is authoritative.** `registered` always comes from the list
  page. If a detail page failed to parse, rebuilding a record from it would
  replace a correct timestamp with "now" and silently wreck every duration and
  week bucket.
- **Records hide until their detail page is in.** Without it a record has no
  rework timestamp and would read "En cours" whether or not it is — thousands
  of fake open cars during the first sync.
- **Three-stage flow.** The rework system closes a Rework ID in three steps:
  Rework In (registered) → Rework Out (repaired) → Quality Control, which is
  what actually releases the harness. A record stays on the watch list until
  the quality control timestamp arrives, and the dashboard lists the ones
  waiting.
- **Error codes are re-synced, not frozen.** Operators can add codes after
  registration and replace the main one during the repair, so the list is
  re-read on every check — but a page that comes back empty never wipes stored
  defects.
- **Parsing is pure and tested.** `site-parsers.ts`, `merge.ts` and `scan.ts`
  have no Nest or TypeORM imports, and are tested against verbatim captured
  HTML.

---

## What the site actually gives us (measured, not assumed)

- The search POST needs **all seven form fields** and a session cookie from
  `/main.php`; detail pages need neither.
- Model codes are **MAM** and **MCM**; everyone calls them **MMA** and **MBEAM**.
- The list page is the **full history**, sorted by registered date — **not** by
  No. (the MAM page has 66 places where a higher No. sits below a lower one, so
  the scanner never trusts row order).
- **Comments are clipped at 60 characters** on both the list and the detail
  page; the full text only exists in the error list's Info column.
- Dates are `yyyy-MM-dd HH:mm:ss` in local plant time. The registered,
  reworked and quality-control rows each carry an **operator number before the
  timestamp**.
- The detail page's main table is **never closed** — a second `<Table>` opens
  before the error codes list, so the parser slices the section explicitly.
- Shifts are letters (**A**/**B**), the quality gate reads
  `EOL Electrical test`, part types are French (`connecteur`), and error
  producers are teams (`Team2`).
- The **Color column is empty** on all 5,939 rows.
- No charset is declared; pages are windows-1252 in practice and decoded by
  detection.

Field meanings come from the operating instruction, `REWORK SEBN manual
7.2.27.pdf` (kept in the repo root) — notably that "error producer" is *who
made the defect*, not who recorded it, and that several fields (Board No.,
Conveyor No., Comment, Complaint ID) are optional and therefore often empty.

---

## Configuration

Everything lives in `.env`; see `.env.example` for the full list with comments.
The ones that matter:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCRAPER_MODE` | `mock` | `mock` = generated data, `live` = real site |
| `SITE_BASE_URL` | rework.jenapp0001… | the rework server |
| `DB_TYPE` / `DB_NAME` | `sqlite` / `ksk_scraper` | one file per mode: `ksk_scraper-live.sqlite` |
| `FAST_SCAN_INTERVAL_MS` | 60 000 (live) | how often the list page is read |
| `MAX_DETAIL_FETCH_PER_CYCLE` | 250 | detail pages per cycle |
| `DETAIL_FETCH_DELAY_MS` | 150 | pause between detail requests |
| `BACKFILL_DAYS` | 0 (everything) | limit the first sync to N days |

## API

| Endpoint | Returns |
| --- | --- |
| `GET /records` | every record whose detail page is in, newest first (`?model=MAM`, `?includePending=true`) |
| `GET /records/status` | scraper health, charset, last scans, sync progress, plant-agent contact |
| `POST /api/scraper/ingest` | a results page pushed by the plant agent; answers with the detail pages to fetch next |
| `POST /api/scraper/ingest/details` | a batch of detail pages, same answer |
| WebSocket | `record.new`, `record.updated`, `record.closed`, `records.refresh` |

Both ingest endpoints require the `x-sync-secret` header and take pages as
base64 of the raw bytes.

---

## Tools

| Command | What it does |
| --- | --- |
| `npm test` | unit tests, including parsers against captured HTML |
| `npm run scrape:probe` | one live search + one detail fetch, prints what parsed, writes nothing |
| `node tools/replay-site.cjs` | serves the captured pages like the real site, for testing off-network |
| `capture.ps1` (+ `capture.bat`) | run on a plant PC to capture pages for analysis — needs nothing installed |

The replay server also simulates live traffic: a new record appearing, a repair,
a quality-control release, and an error code added mid-repair.

---

## Known limits

- **Only two real detail-page layouts** have been seen. Records with several
  error codes, or older records, may reveal variations. Pages that fail to
  parse are written to `debug/` and retried, so nothing is silently lost.
- **Rework rate and first pass yield are estimates.** Both are ratios against
  units produced, and the rework system only knows about units that failed.
  They are computed against an assumed volume (`ASSUMED_UNITS_PRODUCED_PER_DAY`
  in `dashboard/src/lib/config.ts`) and shown with an `est.` marker. A real
  production feed should replace it before these numbers are reported upward.
- **An official API may exist.** The site's developer has offered one; it would
  replace the HTML parsing with structured data and let us request only what
  changed. The source is behind one interface (`RemoteSource`), so adding it is
  a contained change.
- **Live Cloud Connectivity:** The Vercel dashboard (`https://ksk-scraper-ashy.vercel.app`)
  receives live plant updates via the Railway relay backend (`https://ksk-scraper-production.up.railway.app`)
  whenever the `live-sync.bat` agent is running on the SEBN network. When the agent is idle or disconnected,
  it displays the most recent synced data and fallback demo indicators.
