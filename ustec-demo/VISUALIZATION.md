# Chart visualization & PNG artifacts

Server-rendered charts for analysis outcomes — the visual layer of the
analysis functions. Any analysis result becomes a PNG with a **sidecar
manifest**, ready to be referenced by an LLM assembling an HTML report.

```
analysis fn → ChartSpec (pure JSON) → SVG → PNG → reports/<session>/<id>.png + <id>.json
```

## Three surfaces (same semantics everywhere)

```bash
# CLI — analysis + render + save in one command
npm run chart -- --fn signal --start 2025-08-01 --end 2025-09-01 \
    --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --session aug-long

# HTTP — PNG right back (or svg/spec/json)
curl 'http://localhost:5200/api/chart?fn=zones-merged&start=2025-09-01&end=2025-10-01&timeframe=1H' -o zones.png
curl 'http://localhost:5200/api/chart?fn=signal&start=2025-08-01&end=2025-09-01&timeframe=1H&ltfTimeframe=5m&minRR=1.5&format=json&save=1&session=aug-long'

# Browser — WYSIWYG quick capture on the live chart (Capture PNG button
# or window.ustec.capturePng({ title }))
```

`GET /api/artifacts` lists saved sessions; `/api/artifacts/<session>/<file>`
serves the PNG/JSON. Output is **deterministic**: the same query renders
byte-identical PNGs (bundled fonts, no timestamps in pixels).

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

Each `<id>.png` has `<id>.json` — the **sidecar**: `caption`, `altText`,
`provenance` (exact query), `analysisDigest` (bias/signals key fields),
`sha256`. When assembling a report:

1. Call `/api/chart` (or CLI) with `save=1`/`--session <name>`.
2. Read `/api/artifacts` → sessions → sidecars.
3. Copy `report-template.html` into the session dir; fill `#report-summary`
   and one `<figure>` per sidecar, quoting **caption/altText verbatim**
   — never re-derive numbers from pixels.

Report pages are dark-themed via `src/i18n.ts` (`report.*` keys), the
same bilingual EN/VI system as the app, with a language toggle.

## Design rules

- **Point-in-time / no lookahead** — the same guarantee as the analysis
  library; charts are a projection of its outputs.
- **Deterministic** — spec in → identical bytes out; `generatedAt` lives
  in the sidecar, never in pixels.
- **Index-based x-axis** — sessions don't stretch the chart; matches the
  analysis layer's bar-index reasoning.
- **Legend & provenance** — every chart states its verdict in the
  subtitle and its exact query in the footer.