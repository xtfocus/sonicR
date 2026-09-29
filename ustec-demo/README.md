# USTEC M1 Demo

Visualizes OHLC data from `data/USTEC_M1_202508010000_202603031408.csv` using [Lightweight Charts](https://www.tradingview.com/lightweight-charts/), following patterns from `getting-started-lightweight-charts-2025`.

## Run

```bash
cd ustec-demo
npm install
npm run dev
```

Open the URL Vite prints (e.g. http://localhost:5173). The chart loads the CSV from `public/data/`. `npm run dev` also starts the API on http://localhost:5200. Startup, split processes, and ports: [`../STACK.md`](../STACK.md).

## Query data without the browser

```bash
npm run serve-api   # HTTP: curl 'http://localhost:5200/api/range?start=2025-09-01&end=2025-09-02&limit=10'
npm run query -- --start 2025-09-01 --end 2025-09-02 --limit 10 --format csv
```

Same semantics as `window.ustec` on the page (see `help.html` / `DATA_EXPORT.md`); no replay truncation applies.

## Analysis functions

```bash
npm run analyze -- --list                    # catalogue (--lang vi for Vietnamese)
npm run analyze -- --fn structure --start 2025-09-01 --end 2025-12-01 --timeframe 1H
npm run analyze -- --fn signal --start 2026-01-01 --end 2026-02-01 --timeframe 1H --ltf-timeframe 5m --minRR 1.5
curl 'http://localhost:5200/api/analyze?fn=pivots&start=2025-09-01&end=2025-10-01&timeframe=1H&k=8'
```

Pure, point-in-time-safe structure / zone / signal functions over the OHLCV series
(Sonic R workflow as callable building blocks). Same registry drives the CLI, the
HTTP API and the Help page. See `ANALYSIS_FUNCTIONS.md`.

## Charts & reports

```bash
npm run chart -- --fn signal --start 2025-08-01 --end 2025-09-01 --timeframe 1H \
    --ltf-timeframe 5m --minRR 1.5 --session aug-long    # PNG + sidecar → reports/aug-long/
npm run chart -- --fn structure --start 2025-09-01 --end 2025-10-01 --timeframe 1H \
    --annotate 'level@24600@watch'                       # freeform annotation
curl 'http://localhost:5200/api/chart?fn=zones-merged&start=2025-09-01&end=2025-10-01&timeframe=1H' -o zones.png
```

Deterministic server-side renders with sidecar manifests for LLM report
assembly (`report-template.html`). See `VISUALIZATION.md`.

## Language support

The chart page and Help page are bilingual (English / Tiếng Việt). Use the
language selector, or add `?lang=vi` to the URL; the choice persists in
`localStorage`.

## Data

- CSV is tab-separated: `<DATE>`, `<TIME>`, `<OPEN>`, `<HIGH>`, `<LOW>`, `<CLOSE>`, …
- A copy of the CSV lives in `public/data/`. To refresh from the repo root:  
  `cp ../../data/USTEC_M1_202508010000_202603031408.csv public/data/`

## Using the local library build

To use the parent `my-chart` build instead of the npm package:

1. From `my-chart` root: `npm run build`
2. In `ustec-demo/package.json` set `"lightweight-charts": "file:.."`
3. Run `npm install` and `npm run dev`
