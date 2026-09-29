# Data selector tool

Select a time range directly on the chart by dragging, then export the
selected bars as an auto-named CSV download or copy them as a Markdown table.
A floating action popup anchors near the release point (TradingView-like).

## Where it lives

| Piece | Role |
|--------|------|
| `src/selection-tool.ts` | Tool state machine: arm/disarm, drag lifecycle, edge snapping, floating popup with Export/Copy/Clear. |
| `src/selection-band-primitive.ts` | Pane primitive drawing the full-height selection band (live preview + final range). |
| `src/data-export.ts` | CSV/Markdown builders, filename rule, download and clipboard helpers. |
| `src/bar-range.ts` | Shared binary-search helpers: bound lookups + inclusive `[start, end]` slicing over ascending bars. |
| `src/range-query-api.ts` | `window.ustec` programmatic range-query API (same WYSIWYG slicing as the UI tool). |

## How to use

1. Click **Select Range** (next to *Enter Replay*). The chart cursor becomes a crosshair.
2. Press and drag on the chart from left to right (or either direction); both edges snap to the nearest bar.
3. Release. A popup shows symbol, timeframe, bar count and range with three actions:
   - **Export CSV** — downloads the selected bars.
   - **Copy Markdown** — copies a Markdown table to the clipboard (button confirms).
   - **Clear** — removes the selection.

`Escape` cancels an in-flight drag or clears the selection (the tool stays armed).
Clicking without dragging also clears. The tool is disabled while Space-pan
is held (panning wins).

## Exported data

- **Always the active timeframe's bars** (what you see is what you get): select on
  5m → 5m bars; switch the chart to 15m → the same selection re-slices to 15m bars.
- In **replay mode**, the dataset is truncated at the replay cursor, so exports
  never leak bars from the replayed future.
- Selection bounds persist across timeframe switches; edges are re-snapped to
  actual bars of the active timeframe (a band edge must be a bar time, otherwise
  the primitive cannot render it).

### CSV

Header `time,open,high,low,close,tickvol`; timestamps are `YYYY-MM-DD HH:MM:SS`
UTC (same convention as the source MT5 export); `tickvol` is the source `TICKVOL`
(aggregated on higher timeframes).

### Filename rule

```
<SYMBOL>_<TIMEFRAME>_<START>_<END>.csv
USTEC_5m_20250901T0930_20250905T1600.csv
```

Compact sortable UTC stamps (`YYYYMMDDTHHMM`), filesystem-safe.

### Markdown

A titled table ready to paste into notes/PRs:

```markdown
## USTEC 5m — 412 bars — 2025-09-01 09:30 → 2025-09-05 16:00 UTC

| time | open | high | low | close | tickvol |
|---|---|---|---|---|---|
| 2025-09-01 09:30:00 | 25433.5 | 25440.0 | 25430.1 | 25438.2 | 812 |
```

## Programmatic API (`window.ustec`)

The same replay-aware slicing the UI performs is callable from the console or
scripts (via `src/range-query-api.ts`, wired in `main.ts`):

```js
// 'YYYY-MM-DD HH:MM[:SS]' is UTC (source CSV convention)
const r = window.ustec.queryRange('2025-09-01 09:30', '2025-09-05 16:00');
// cap the rows returned (taken from the start of the range)
window.ustec.queryRange('2025-09-01', '2025-10-01', { timeframe: '1H', limit: 10 });
r.barCount;     // 412
r.from; r.to;   // actual first/last bar times, 'YYYY-MM-DD HH:MM:SS' UTC
r.available;    // full extent of the queried dataset (UTC seconds)
r.bars[0];      // { time, open, high, low, close, volume }

// query a timeframe other than the active one (label or seconds)
window.ustec.queryRange('2025-09-01', '2025-10-01', { timeframe: '1H' });
window.ustec.queryRange(1756724400, 1756983600, { timeframe: 300 });

// re-query whatever is currently selected on the chart (null when none)
window.ustec.getSelection();

// serialize exactly like the UI's Export CSV payload
window.ustec.toCsv(r);
```

Time arguments accept UTC epoch seconds, `'YYYY-MM-DD[ T]HH:MM[:SS]'` (UTC,
the source CSV convention), date-only `'YYYY-MM-DD'` (UTC midnight), or ISO
8601 with an explicit timezone (`…Z` / `…±HH:MM`). Other ISO forms without a
timezone are rejected — they would silently parse as local time. `end` before
`start` is swapped. `{ limit }` caps rows taken from the start of the range
(positive integer; anything else throws). Unknown timeframes and invalid
times throw with the accepted formats.

In replay mode results are truncated at the replay cursor, exactly like the
UI exports; querying a non-active timeframe returns that timeframe's bars
truncated at the same replay time.

## HTTP API and CLI (Node)

The same query core (`src/ustec-data.ts` + `src/range-query-api.ts`) powers a
local HTTP endpoint and a CLI, runnable from `ustec-demo/`. Server-side there
is no replay cursor — queries always see the full dataset; the default
timeframe when omitted is `5m`.

```bash
# HTTP endpoint (default port 5200, --port to change)
npm run serve-api
curl 'http://localhost:5200/api/range?start=2025-09-01&end=2025-09-02&limit=10'
curl 'http://localhost:5200/api/range?start=2025-09-01&end=2025-09-02&timeframe=1H&format=csv'

# CLI
npm run query -- --start '2025-09-01 09:30' --end '2025-09-05 16:00' --limit 10 --format csv
```

HTTP: query params mirror the JS options (`start`, `end`, `timeframe`,
`limit`, `format=json|csv`); errors return 400 with `{ error }`, unknown
paths 404; CSV responses reuse the UI export filename in
`Content-Disposition`. CLI: same flags (`--help` for usage); errors print to
stderr with exit code 1.
