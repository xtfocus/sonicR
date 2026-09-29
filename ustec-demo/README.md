# USTEC M1 Demo

Visualizes OHLC data from `data/USTEC_M1_202508010000_202603031408.csv` using [Lightweight Charts](https://www.tradingview.com/lightweight-charts/), following patterns from `getting-started-lightweight-charts-2025`.

## Run

```bash
cd ustec-demo
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5173). The chart loads the CSV from `public/data/` and displays candlesticks.

## Query data without the browser

```bash
npm run serve-api   # HTTP: curl 'http://localhost:5200/api/range?start=2025-09-01&end=2025-09-02&limit=10'
npm run query -- --start 2025-09-01 --end 2025-09-02 --limit 10 --format csv
```

Same semantics as `window.ustec` on the page (see `help.html` / `DATA_EXPORT.md`); no replay truncation applies.

## Data

- CSV is tab-separated: `<DATE>`, `<TIME>`, `<OPEN>`, `<HIGH>`, `<LOW>`, `<CLOSE>`, …
- A copy of the CSV lives in `public/data/`. To refresh from the repo root:  
  `cp ../../data/USTEC_M1_202508010000_202603031408.csv public/data/`

## Using the local library build

To use the parent `my-chart` build instead of the npm package:

1. From `my-chart` root: `npm run build`
2. In `ustec-demo/package.json` set `"lightweight-charts": "file:.."`
3. Run `npm install` and `npm run dev`
