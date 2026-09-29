---
name: analysis-visualization
description: >
  Use when asked to produce charts, PNG images, annotated snapshots, or
  HTML reports from technical-analysis results — turning analysis
  function output into human-viewable visuals and artifacts that an LLM
  can reference when assembling a final report. Covers the server-side
  deterministic renderer (structure/zones/liquidity/signal/pois/
  equilibrium/bias-timeline/mtf-stack), freeform annotation, PNG + sidecar
  manifests, and the report-figure contract.
---

# Analysis visualization & report artifacts

The analysis utilities (`technical-analysis` skill) produce JSON; this
layer turns that JSON into charts humans and LLMs consume. One pipeline:

```
analysis function → ChartSpec (JSON) → SVG → PNG + sidecar manifest
                                        → cases/<case>/ → HTML report
```

## When to use

- "Show me a chart of the setup" → `signal` chart (the money chart)
- "Visualize the zones / structure / liquidity" → the matching chart fn
- "Snapshot what's on screen" (live app) → Capture PNG button /
  `window.ustec.capturePng({ title })`
- "Build a report with figures" → see the artifact contract below

## Chart functions (CLI + HTTP, identical semantics)

| fn | View | Human question |
|----|------|----------------|
| `structure` | zigzag + A/B/C labels + BOS/CHoCH | What is the market doing? |
| `zones-merged` | lifecycle-styled zones, provenance labels | Where does it react? |
| `liquidity` | old extremes + equal pools | Where is it drawn? |
| `signal` | POIs + entry/stop/target bracket + shaded risk/reward + R:R | What's the trade? |
| `pois` / `equilibrium` / `bias-timeline` / `mtf-stack` | filtered POIs / 50% levels / regime bands / top-down rows | supporting views |

```bash
# CLI — run analysis, render, save PNG + sidecar
npm run chart -- --fn signal --start 2025-08-01 --end 2025-09-01 \
    --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --case aug-long

# HTTP — PNG directly, or svg/spec/json
curl 'http://localhost:5200/api/chart?fn=zones-merged&start=2025-09-01&end=2025-10-01&timeframe=1H' -o zones.png

# annotations (repeatable, '@'-separated — times contain colons)
npm run chart -- --fn structure --start 2025-09-01 --end 2025-10-01 --timeframe 1H \
    --annotate 'level@24600@watch' --annotate 'text@2025-09-08 14:00,26250@note'
```

Annotation kinds: `level@price@label`, `vline@time@label`,
`marker@time@shape@label`, `text@time,price@text`, `zone@bottom,top@dir@label`.

## Provenance on every chart

- Subtitle = the analysis verdict (e.g. `HH_HL · 2 POI(s) · 1 signal(s) ·
  best R:R 1.96` — this is what you quote).
- Footer = the exact query (`fn=signal minRR=1.5 …`) — sidecar echoes it.
- No timestamps inside pixels: same query → byte-identical PNG
  (deterministic; bundled fonts).

## Artifact contract (the LLM report assembly rule)

Every chart saved to a case produces a self-contained folder:

```
cases/<case>/
  case.json      # manifest: symbol, range, sourceCsvSha256, bars[], charts[], analysis[]
  data/bars_{tf}.csv        # pinned data — the exact bars the analysis ran on
  analysis/<fn>.json        # raw analysis output
  charts/<id>.png + .json   # rendered chart + sidecar
  report/                   # assembled HTML report (optional)
```

The sidecar carries `caption` (one-sentence verdict with exact numbers,
e.g. "USTEC 1H 2025-08-20 → 2025-09-01: HH_HL long only; OB POI
23177–23212; entry 23212, stop 23165, R:R 1.96, 7 targets"), `altText`,
`provenance` (the query), `analysisDigest` (bias, POI count, signals),
and `sha256`. The pinned `data/` CSV + `sourceCsvSha256` make every
figure recomputable even after the feed updates.

**When assembling an HTML report: quote the sidecar verbatim — never
re-derive numbers from pixels.** Flow:

1. `npm run chart -- … --case <name>` (or `/api/chart…&save=1`)
2. Read `cases/<name>/case.json` (or `GET /api/artifacts`) → sidecars
3. Copy `report-template.html` into `cases/<name>/report/`; fill
   `#report-summary` + one `<figure>` per artifact, `<img>` referencing
   `charts/<id>.png` and the caption from its sidecar

Agents may also POST a full ChartSpec to `/api/chart` (or `--spec
spec.json`) to hand-render bespoke annotated charts without running an
analysis.

The template is EN/VI bilingual (same `data-i18n` mechanism as the app).

## Design rules to respect

- Charts mirror the analysis semantics exactly (lifecycle states:
  fresh/touched tradeable, mitigated busted, broken gone) — anchor styling
  meaning in `src/viz/theme.ts`, not in ad-hoc colors.
- X-axis is bar-index based: weekend gaps don't stretch charts.
- Prefer `signal` chart when a setup exists; pre-check `--fn bias` on the
  analysis side so you don't render empty setups.