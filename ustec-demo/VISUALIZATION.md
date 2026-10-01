# Chart visualization & PNG artifacts

Server-rendered charts for analysis outcomes — the visual layer of the
analysis functions. Any analysis result becomes a PNG with a **sidecar
manifest**, ready to be referenced by an LLM assembling an HTML report.

```
analysis fn → ChartSpec (pure JSON) → SVG → PNG + sidecar manifest
                                    → cases/<case>/{data, analysis, charts} → HTML report
```

## Cases — self-contained artifact folders

```
cases/<case-id>/
  case.json            # manifest: symbol, range, sourceCsvSha256, bars[], charts[], analysis[]
  data/                # pinned data snippets — the EXACT bars each analysis ran on
    bars_1H.csv
    bars_5m.csv
  analysis/            # raw function outputs, one JSON per fn
    signal_1H_5m.json
  charts/              # rendered PNGs + sidecars
    signal_1H_5m_01.png
    signal_1H_5m_01.json
  report/
    index.html         # LLM-assembled report (optional)
```

Pinning the used bars (plus `sourceCsvSha256` of the feed) makes every
chart recomputable even after the source data updates — a report's
claims stay verifiable indefinitely.

## Three surfaces (same semantics everywhere)

```bash
# CLI — analysis + render + save in one command (case = pinned folder)
npm run chart -- --fn signal --start 2025-08-01 --end 2025-09-01 \
    --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --case aug-long

# HTTP — PNG right back (or svg/spec/json)
curl 'http://localhost:5200/api/chart?fn=zones-merged&start=2025-09-01&end=2025-10-01&timeframe=1H' -o zones.png
curl 'http://localhost:5200/api/chart?fn=signal&start=2025-08-01&end=2025-09-01&timeframe=1H&ltfTimeframe=5m&minRR=1.5&format=json&save=1&case=aug-long'

# Agent-authored chart: POST any ChartSpec body → PNG (or ?format=svg)
curl -X POST http://localhost:5200/api/chart -H 'content-type: application/json' \
    --data-binary @spec.json -o agent.png

# CLI twin of the POST: render a spec file without running analysis
npm run chart -- --spec spec.json --out agent.png

# Browser — WYSIWYG quick capture on the live chart (Capture PNG button
# or window.ustec.capturePng({ title }))
```

`GET /api/artifacts` lists cases; `/api/artifacts/<case>/<charts|data|analysis|report>/<file>`
serves the png/json/csv. Output is **deterministic**: the same query
renders byte-identical PNGs (bundled fonts, no timestamps in pixels).

## Chart types (fn → view)

| fn | What it shows | Answers |
|----|---------------|---------|
| `structure` | candles + zigzag + A/B/C labels + BOS/CHoCH markers | "What is the market doing?" |
| `zones-merged` | FVG/OB/S&D rectangles, lifecycle-styled, provenance labels | "Where does price react?" |
| `liquidity` | old highs/lows + equal-high/low pools | "Where is price drawn?" |
| `signal` | bias verdict + POIs + the setup: entry/stop/target bracket, shaded risk/reward, R:R | "What's the trade?" |
| `pois` | bias-filtered tradeable POIs only | "Which levels matter?" |
| `equilibrium` | legs + 50% Sonic R midpoints | "Where's the discount?" |
| `bias-timeline` | regime bands (teal long / red short / gray range) over real candles | "When was it tradeable?" |
| `mtf-stack` | one mini-chart per timeframe, bias in each subtitle | "Top-down agreement?" |

Freeform annotation on any chart (`--annotate`, repeatable):

```
level@<price>[@label]                e.g. --annotate 'level@24600@watch'
vline@<time>[@label]                 e.g. --annotate 'vline@2025-08-05 10:00@CPI'
marker@<time>@<shape>[@label]        shapes: triangle-up|triangle-down|dot|cross|arrow-up|arrow-down
text@<time>,<price>@<text>           e.g. --annotate 'text@2025-09-08 14:00,26250@note'
zone@<bottom>,<top>@<bull|bear>[@label]
```

The separator is `@` because time values contain colons.

## Where it lives

| Piece | Role |
|--------|------|
| `src/viz/types.ts` | ChartSpec + overlay primitives (zone, level, polyline, marker, vline, bracket, text, band). |
| `src/viz/theme.ts` | Dark/light palettes; zone lifecycle styling (fresh/touched/mitigated/broken) in one place. |
| `src/viz/layout.ts` | Price/time scales, ticks, padding — the only geometry module. |
| `src/viz/svg.ts` | ChartSpec → SVG string (deterministic, text width estimated). |
| `src/viz/png.ts` | SVG → PNG via `@resvg/resvg-js` with bundled DejaVu fonts (`assets/fonts/`). |
| `src/viz/adapters.ts` | Analysis outputs → overlays (pivots, zones, liquidity, signals). |
| `src/viz/composites.ts` | One-call charts: structure, zones, liquidity, signal. |
| `src/viz/coverage.ts` | pois, equilibrium, bias-timeline, mtf-stack. |
| `src/viz/annotate.ts` | Freeform `--annotate` parsing. |
| `src/node/chart-core.ts` | Shared chart-request core (CLI + HTTP single path). |
| `src/node/artifacts.ts` | `reports/<session>/` persistence, sidecar + manifest. |
| `src/node/chart-cli.ts` | `npm run chart`. |
| `report-template.html` | Dark HTML report skeleton for LLM assembly. |

## The LLM assembly contract

Each chart `<id>.png` has `<id>.json` — the **sidecar** (caption,
provenance, analysisDigest, sha256). The case manifest (`case.json`) is
the single entry point: it lists pinned bars, analysis outputs and every
chart with its sidecar. When assembling a report:

1. Render with `save=1` / `--case <name>` — pins `data/` (exact bars)
   and `analysis/` (raw outputs) alongside the charts.
2. Read `/api/artifacts` (or each case's `case.json`) → charts → sidecars.
3. Copy `report-template.html` into `cases/<case>/report/`; fill
   `#report-summary` and one `<figure>` per sidecar, quoting
   **caption/altText verbatim** — never re-derive numbers from pixels.

Report pages are dark-themed via `src/i18n.ts` (`report.*` keys), the
same bilingual EN/VI system as the app, with a language toggle.

## One-command standard report

```bash
# bias scan + 5 charts (timeline, structure, zones, liquidity, signal)
# + data/analysis pinning + template + summary.json
npm run report -- --start 2025-08-01 --end 2025-09-01 \
    --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --case aug-2025
# → cases/aug-2025/report/{index.html, summary.json}
```

`report/summary.json` is the facts an LLM quotes (`regime`, per-window
verdicts in `windows`, chart captions, range); the narrative step fills
`report/index.html` from it + the sidecars. Quote JSON, never pixels —
every statable number must exist there first (`GET /api/meta` reports
the dataset extent for range-resolution ("most recent window" anchors
at `available.end` — the feed is historical, not live).

## Design rules

- **Point-in-time / no lookahead** — the same guarantee as the analysis
  library; charts are a projection of its outputs.
- **Deterministic** — spec in → identical bytes out; `generatedAt` lives
  in the sidecar, never in pixels.
- **Index-based x-axis** — sessions don't stretch the chart; matches the
  analysis layer's bar-index reasoning.
- **Legend & provenance** — every chart states its verdict in the
  subtitle and its exact query in the footer.