# KSK Rework Dashboard

React + Vite + TypeScript + ECharts + Tailwind v4 front end for the KSK rework
monitoring backend.

## Running it

The backend must be up first — it serves both the REST API and the WebSocket:

```bash
cd ..            # project root
docker compose up -d
```

Then:

```bash
npm install
npm run dev      # http://localhost:5173
```

The API base URL defaults to `http://localhost:3000`. Override it with
`VITE_API_URL` in a `.env` file if the backend runs elsewhere (e.g. when it's
deployed on the factory PC and you're viewing from another machine).

## What's built

- **Overview** — fully wired to the live API and WebSocket.
- Everything else (Rework analysis, Defects, Pareto, Trends, KPI, Reports) is a
  placeholder listing its planned contents. Built incrementally on purpose.

## Things worth knowing before changing charts

**The palette is validated, not decorative.** `src/lib/viz-tokens.ts` holds the
categorical series colours, and their *order* is the colourblind-safety
mechanism. They were checked in both light and dark mode (lightness band,
chroma floor, CVD separation, normal-vision separation, surface contrast).
Re-run the validator before reordering or substituting any hex.

**Every chart ships a table view.** Three light-mode series colours sit below
3:1 contrast against the surface, which obligates "relief" — a way to read
every value without relying on colour. That's why `ChartCard` requires a
`table` prop rather than treating it as optional.

**The trend chart is deliberately not a dual-axis combo.** Rework quantity (a
count) and rework rate (a percentage) have unrelated scales; overlaying them on
two y-axes manufactures a correlation that isn't in the data. They're drawn as
two panels sharing one x-axis instead.

**Two KPIs are estimates.** Rework rate and first pass yield are ratios against
*units produced*, and the KSK system only knows about units that failed.
`ASSUMED_UNITS_PRODUCED_PER_DAY` in `src/lib/config.ts` stands in for a real
production feed. Both tiles render an `est.` marker so the numbers aren't
mistaken for measured values — replace the constant with a real feed (MES, line
counter, ERP) and drop the flag.

**The model filter is derived from the data**, not hardcoded. It currently shows
MAM/MCM because that's what the mock backend serves; it'll show the real
programme codes with no code change.
