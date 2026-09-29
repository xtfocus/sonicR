# Handoff — Technical-analysis agent toolchain (my-chart)

**Purpose of this feature**: a full toolchain that lets humans **and AI
agents** run technical analysis on the USTEC dataset, visualize the
results as deterministic chart PNGs, store them as self-contained
inspectable "cases," and assemble human-readable HTML reports from the
artifacts. Skills teach Claude Code the workflow; CLI/HTTP let any agent
drive it programmatically.

**Where**: `my-chart` repo, branch `feature/analysis-functions`
(14 commits ahead of `master`, working tree clean at handoff).
All work lives under `my-chart/ustec-demo/` plus the skills at
`my-chart/.claude/skills/`.

---

## Quickstart (the 30-second tour)

```bash
cd my-chart/ustec-demo
npm install                          # deps: vite, tsx, lightweight-charts, @resvg/resvg-js

# 1. Query raw bars
npx tsx src/node/cli.ts --start 2025-09-01 --end 2025-10-01 --timeframe 1H

# 2. Analysis (13 pure functions)
npx tsx src/node/analyze-cli.ts --fn bias --start 2026-01-01 --end 2026-03-31 --timeframe 1H
npx tsx src/node/analyze-cli.ts --fn signal --start 2025-08-01 --end 2025-09-01 --timeframe 1H --ltf-timeframe 5m --minRR 1.5

# 3. Chart any function → PNG (deterministic)
npx tsx src/node/chart-cli.ts --fn signal --start 2025-08-01 --end 2025-09-01 --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --case aug-long

# 4. FULL REPORT in one command (the standard flow)
npx tsx src/node/report-cli.ts --start 2026-01-01 --end 2026-03-31 --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --case jan-mar-2026

# 5. View it (two options)
npm run serve-api    # then open http://localhost:5200/api/report/jan-mar-2026
npm run dev          # then open http://localhost:5275/cases.html (cases list)

# 6. HTTP twin (same semantics, for agents/notebooks)
curl http://localhost:5200/api/meta
curl http://localhost:5200/api/functions
curl http://localhost:5200/api/analyze?fn=bias&start=2026-01-01&end=2026-03-31&timeframe=1H
curl http://localhost:5200/api/chart?fn=zones-merged&start=2026-01-01&end=2026-03-31&timeframe=1H
```

`npm run` scripts exist for all of the above (`analyze`, `chart`,
`report`, `query`, `serve-api`); prefer `npx tsx src/node/...` when piping
output to JSON parsers (npm prefix lines pollute stdout).

---

## What exists (all verified working)

### Layer 1 — Analysis library (`ustec-demo/src/analysis/`)
Pure, point-in-time-safe functions over OHLCV. **13 functions** in 3
layers, one registry (`registry.ts`) powers CLI, HTTP catalogue and docs:

| Layer | Functions |
|---|---|
| structure | `pivots` (zigzag), `structure` (HH_HL/LH_LL/RANGE), `bos`, `choch`, `equilibrium` |
| zones | `fvg`, `order-blocks`, `supply-demand`, `zones-merged` (confluence+provenance), `liquidity` |
| signal | `bias`, `pois`, `signal` (bias ∧ POI arrival ∧ LTF CHoCH ∧ minRR → entry/stop/targets) |

Key guarantees: no repaint (`confirmedAt`), bar-close sampling, fractal
via one `k` parameter, regime gate (RANGE ⇒ `stand_aside`, zero signals).

### Layer 2 — Visualization (`ustec-demo/src/viz/`)
ChartSpec (pure JSON: bars + overlay primitives + layout) → SVG → PNG via
`@resvg/resvg-js` with bundled DejaVu fonts (`assets/fonts/`).
**Byte-deterministic** (same query → same sha256; `generatedAt` only in
sidecar). 8 chart types + freeform annotation:

- Charts: `structure`, `zones-merged`, `liquidity`, `signal` (the money
  chart: entry/stop/target bracket + R:R), plus `pois`, `equilibrium`,
  `bias-timeline`, `mtf-stack`.
- Annotation: `--annotate 'level@24600@watch'`, `marker@time@shape@…`,
  `text@time,price@…`, `zone@bottom,top@dir@…`, `vline@…`. Separator is
  `@` because times contain colons.
- Agent-authored charts: `npm run chart -- --spec spec.json` or
  `POST /api/chart` with a full ChartSpec body (empty-bars scenes OK).

### Layer 3 — Cases + reports (`ustec-demo/src/node/` + `cases/`)
A **case** is a self-contained folder; `npm run report` builds the
standard case (5 charts + everything below):

```
cases/<case-id>/
  case.json            # manifest: sourceCsvSha256, bars[], charts[], analysis[]
  data/bars_1H.csv     # pinned bars the analysis ran on (reproducibility)
  data/bars_5m.csv
  analysis/<fn>.json   # raw analysis outputs
  charts/<id>.png + .json  # chart + sidecar (caption, digest, sha256)
  report/index.html    # auto-filled: 5 figures + facts digest (LLM polishes #report-summary)
  report/summary.json  # facts the LLM quotes (regime, captions, rangeClippedToDataEnd)
```

`cases/` is gitignored (outputs, not source).

### Web UI (bilingual EN/VI — `src/i18n.ts`, `data-i18n` attrs)
- Chart page (`index.html`): chart + replay + Sonic R overlays +
  `Capture PNG` button (`window.ustec.capturePng()`), toolbar: Timeframe,
  Replay, Select Range, **Capture PNG**, Help, **Cases**, Language.
- `cases.html`: lists cases from the API (cross-port via CORS),
  Refresh, per-case **Open report** link.
- `help.html`: full docs incl. generated Analysis-functions catalogue
  (from the registry) and Charts & reports section.
- `report-template.html`: dark report skeleton, figures auto-inserted.

### Skills (make the workflow self-discoverable)
- `analysis-workflow` — START HERE: range-resolution ladder, bias gate,
  standard case, report assembly contract.
- `technical-analysis` — the 13 functions' semantics + pitfalls.
- `analysis-visualization` — chart types, annotations, artifact contract.

---

## Commit map (newest → oldest)

| Commit | What |
|---|---|
| `317cc31` | Cases list page + toolbar button + CORS |
| `cd43844` | Report driver auto-fills figures + digest |
| `158a79e` | Static case serving `/cases/...` + `/api/report/<case>` |
| `e45a1d7` | **Bugfix**: monthly-scan truncation; `clippedFromEnd` flag |
| `92a6617` | `npm run report`, `/api/meta`, shared case-writer, workflow skill |
| `4a5dbf9` | Skill sync to cases layout |
| `3a0d3b4` | Case folders with pinned data; `POST /api/chart` + `--spec` |
| `c4465ba` | M6: report template, VISUALIZATION.md, help charts, viz skill |
| `b2da5e3` | Browser capture button + `window.ustec.capturePng()` |
| `2e4d061` | Coverage charts + `--annotate` parser |
| `69d5c36` | CLI `npm run chart`, `/api/chart`, sidecars |
| `07d2042` | Core composites (structure/zones/liquidity/signal) |
| `c64bc8f` | Viz engine (spec/theme/layout/svg/png) |
| `465d779` | Analysis functions + technical-analysis skill |

---

## HTTP surface (single server, `npm run serve-api`, port 5200)

| Endpoint | Purpose |
|---|---|
| `GET /api/meta` | symbol, timeframes, `available` extent — range discovery |
| `GET /api/range` | bars in range (`clippedFromEnd`, `format=csv`) |
| `GET /api/functions` | analysis catalogue, EN/VI (`?lang=vi`) |
| `GET /api/analyze` | run any of 13 functions |
| `GET /api/chart` | analysis→PNG (`format=png\|svg\|spec\|json`, `save=1`) |
| `POST /api/chart` | agent-authored ChartSpec body → PNG |
| `GET /api/artifacts` | cases index |
| `GET /api/artifacts/<case>/<kind>/<file>` | charts/data/analysis/report files |
| `GET /api/report/<case>` | 302 → the case's report page |
| `GET /cases/<case>/<path>` | static case mount (report images resolve) |

Every response carries `access-control-allow-origin: *` (local tool).

---

## Known issues & sharp edges (be honest, they're real)

1. **`/src/help-main.ts` 404s on the API server** — the report page's
   EN/VI toggle only works under the vite dev server; page still renders.
   Fix idea: inline a tiny toggle script in `report-template.html`.
2. **Report narrative is EN-only** — sidecar captions/digest are English;
   the template chrome is bilingual. If VI reports matter, add a
   translation layer. Deliberate for now (numbers > prose fidelity).
3. **Time data is historical** — "recent" anchors at `available.end`
   (2026-03-03), never wall-clock. After that date the feed is stale;
   no live-data adapter exists yet.
4. **Interactive annotation on the live chart NOT built** — user
   explicitly deferred it during planning (annotation is CLI/HTTP only).
5. **`k` defaults are fixed** (5 analysis / 3 LTF) — fine for 1H/5m;
   no auto-scaling per timeframe.
6. **No multi-symbol support** — hardcoded `USTEC` throughout (dataset,
   captions, `DatasetMeta`). Adding a symbol requires a new data source.
7. **minRR gating regularly yields zero setups** — that IS the system
   working (regime gate); don't mistake it for a bug. Use `--minRR 1.5`
   to see borderline setups.
8. **Vite preview (built dist) doesn't serve `cases/`** — report viewing
   requires `npm run dev` or `npm run serve-api` (or a static server).
   Opening `report/index.html` from disk works except the lang toggle.

---

## Verification evidence (what was actually proven)

- **Determinism**: same spec → identical sha256 across CLI/HTTP/direct
  render; subagent confirmed a regenerated case matched byte-for-byte.
- **Golden windows**: structure (Sep 2025), zones + signal (Aug 2025) all
  render; signal caption quotes exact verified numbers (OB 23177–23212,
  entry 23212, stop 23165, R:R 1.96 — run with `--minRR 1.5`).
- **Subagent E2E runs** (fresh agents, no conversation):
  - `PipelineTest` (3m55s): found **2 real bugs** (monthly-scan
    truncation; silent clipping) — both fixed in `e45a1d7`.
  - `PipelineTest2` (13m32s): fixes held; report viewable via web;
    its slowness was a tooling artifact (foreground-blocked call), not
    pipeline cost — every command runs in 3–6 s when invoked directly.
  - `E2ETest3` (8m34s): reused a pre-existing case after verifying
    sha-identity (deterministic), then assembled a correct narrative —
    self-corrected a March-verdict drafting error.
  - `E2ETest4` (12m22s, from scratch with empty `cases/`): generated the
    full case (5 charts + pinned data + analysis) and — because the
    full Jan–Mar window legitimately yielded 0 setups (all 5 POIs
    consumed over 2 months) — followed the workflow skill's "narrow the
    window" guidance and added a Feb sub-window signal chart with **2
    real qualifying setups: FVG 24979–24991, entry 24979, stop 25004,
    R:R 2.00, 8 targets; and a second at R:R 7.95**. Polished the report
    narrative and left 6 figures in
    `cases/jan-mar-2026/report/index.html`.
    **Takeaway**: window length is a first-class choice — a full
    multi-month window consumes POIs; narrow to the trending sub-window
    to surface setups (see sharp edge 7).
- **UI verified in headless Chromium**: chart toolbar (Capture PNG,
  Cases), cases list page, bilingual toggles, report page with 5 inline
  figures at full resolution, digest surviving i18n re-render.

---

## Natural next steps (when you pick this up)

1. **Harvest E2ETest4** — read its report; if it found new issues, fix.
2. **Report-toggle inline script** (issue 1) — makes API-served reports
   fully interactive with zero dependencies.
3. **Live data**: the whole pipeline assumes the static CSV; a
   `loadApi` swap for a live feed is the single biggest extension, and
   `clippedFromEnd`/`available` already handle it.
4. **Interactive chart annotation** (deferred by user, still open).
5. **`--annotate` polyline grammar** — slanted lines exist in the spec
   (POST), but the quick string grammar lacks `polyline@…`.
6. **Multi-symbol**: de-hardcode `USTEC`, add data-source abstraction.
7. **Backtest shim**: analysis yields signals with targets; hooking a
   simple outcome evaluator (did entry→target hit?) would close the loop.
8. Deep-dive residue: zone `minGap` defaults, `biasTimeline` monthly
   window size parameter, `equilibriumChart` count defaults.

---

## Files worth reading first (locator)

| File | Why |
|---|---|
| `ustec-demo/ANALYSIS_FUNCTIONS.md` | the 13 functions + design rules |
| `ustec-demo/VISUALIZATION.md` | ChartSpec, cases layout, LLM assembly contract |
| `.claude/skills/analysis-workflow/SKILL.md` | the runbook agents follow |
| `ustec-demo/src/node/report-cli.ts` | the orchestrator (report → case → page) |
| `ustec-demo/src/node/artifacts.ts` | case persistence + sidecars |
| `ustec-demo/src/analysis/registry.ts` | single source for fn ids/params/docs |
| `ustec-demo/src/viz/svg.ts` | the renderer (all pixel decisions) |

Good luck — the pipeline is deterministic and auditable end to end:
every figure traces to a query, every query to pinned data, every case to
a sha256 of the source feed.