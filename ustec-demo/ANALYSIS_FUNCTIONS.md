# Analysis functions

A pure, point-in-time-safe function library over the OHLCV series — the
Sonic R workflow as callable building blocks. Three layers, one entry
point each for the CLI and the HTTP API:

1. **structure** — confirmed swing pivots (zigzag), labelled legs, market
   structure classification (HH/HL / LH/LL / RANGE), BOS/CHoCH events,
   leg equilibriums.
2. **zones** — FVG, BOS-anchored order blocks, pivot-anchored
   supply/demand bases, zone lifecycle (`fresh/touched/mitigated/broken`),
   confluence merging, liquidity map.
3. **signal** — the composite: HTF bias ∧ POI arrival ∧ LTF CHoCH trigger
   ∧ R:R gate, with entry/stop/targets.

## Where it lives

| Piece | Role |
|--------|------|
| `src/analysis/types.ts` | Shared types (pivot, leg, zone, event, signal, result envelope). |
| `src/analysis/structure.ts` | Pivots/zigzag, labels, structure classification, BOS/CHoCH, equilibrium. |
| `src/analysis/zones.ts` | FVG / OB / S&D finders, merge, lifecycle, liquidity. |
| `src/analysis/signal.ts` | Bias, POI selection, composite entry signals. |
| `src/analysis/registry.ts` | The function registry — ids, params, EN/VI docs; single source for CLI + HTTP + the Help page. |
| `src/node/analyze-cli.ts` | CLI entry (`npm run analyze`). |
| `src/node/serve.ts` | HTTP endpoints `/api/analyze`, `/api/functions`. |

## Design rules

- **Pure** — functions take bars + numeric params and return JSON; the same
  code runs in the browser, CLI and server.
- **No repaint** — pivots carry `confirmedAt` (the earliest bar close at
  which they were knowable); BOS/CHoCH and zones key off it. Everything is
  evaluated on bar closes. Replaying history gives identical results to
  live.
- **Fractal via one knob** — the `k` parameter scales the zigzag. Bigger =
  swing/HTF structure, smaller = internal/LTF structure.
- **De-duplicated confluence** — `zones-merged` merges overlapping zones
  created near in time (≤ 5 days apart); `provenance` lists *distinct*
  logics (OB, FVG, SD) so "three confirmations at one price" is one POI,
  not three (see `mergeZones`).
- **Regime gate** — RANGE structure ⇒ `stand_aside`, no signals.

## CLI

```bash
npm run analyze -- --list                    # catalogue (--lang vi for Vietnamese)
npm run analyze -- --fn pivots --start 2025-09-01 --end 2025-10-01 --timeframe 1H
npm run analyze -- --fn structure --start 2025-09-01 --end 2025-12-01 --timeframe 1H --lookback 8
npm run analyze -- --fn signal --start 2026-01-01 --end 2026-02-01 --timeframe 1H --ltf-timeframe 5m --minRR 1.5
npm run analyze -- --fn order-blocks --start 2025-11-01 --end 2025-12-01 --timeframe 1H --bodyOnly
```

Flags `--fn --start --end --timeframe --ltf-timeframe --format --csv
--lang --list --help` are consumed by the CLI; every other flag is
forwarded to the function as a parameter (bare boolean flags mean `true`).
`--format csv` emits tabular rows (pivots/zones/events/signals); scalar
results print as `key,value`.

## HTTP API

```bash
npm run serve-api
curl 'http://localhost:5200/api/functions?lang=vi'          # catalogue as JSON
curl 'http://localhost:5200/api/analyze?fn=pivots&start=2025-09-01&end=2025-10-01&timeframe=1H&k=8'
curl 'http://localhost:5200/api/analyze?fn=signal&start=2026-01-01&end=2026-02-01&timeframe=1H&ltfTimeframe=5m&minRR=1.5'
```

`fn`, `start`, `end` are required; `timeframe` (default `5m`) sets the
analysis series, `ltfTimeframe` the trigger series for `signal`. Any
unknown parameter or bad value returns 400 with `{ error }` listing the
accepted parameters. `GET /api/functions` is the machine-readable twin of
the Help page catalogue — AI agents and notebooks can discover the full
surface from it.

## Result envelope

Every function returns the same shape:

```json
{
  "fn": "pivots",
  "intervalSeconds": 3600,
  "barCount": 1474,
  "from": 1756684800,
  "to": 1764547200,
  "data": { "pivots": [ ... ], "legs": [ ... ] }
}
```

## Function catalogue

| id | category | summary |
|----|----------|---------|
| `pivots` | structure | Confirmed swing pivots + A→B→C leg labels. |
| `structure` | structure | HH/HL, LH/LL or RANGE classification. |
| `bos` | structure | Break-of-structure events (continuation). |
| `choch` | structure | Change-of-character events (reversal trigger). |
| `equilibrium` | structure | 50% levels of recent zigzag legs. |
| `fvg` | zones | Fair-value gaps with lifecycle state. |
| `order-blocks` | zones | BOS-anchored order blocks. |
| `supply-demand` | zones | Pivot-anchored consolidation bases. |
| `zones-merged` | zones | All zone kinds merged into POIs. |
| `liquidity` | zones | Old extremes + equal high/low pools. |
| `bias` | signal | long_only / short_only / stand_aside. |
| `pois` | signal | Bias-filtered still-tradeable POIs. |
| `signal` | signal | Full composite: bias ∧ POI ∧ CHoCH ∧ R:R. |