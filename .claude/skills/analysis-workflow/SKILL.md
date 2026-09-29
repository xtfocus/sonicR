---
name: analysis-workflow
description: >
  Use when the request is a full analysis: "analyze USTEC", "what's the
  market doing and show me", "generate a report", or any request that
  chains range selection → bias → charts → report. Orchestrates the
  two function skills (technical-analysis for the analysis, analysis-
  visualization for the figures) into one runbook: resolve the time
  window, gate on regime, save a standard case, assemble the report.
  Use this skill FIRST to plan, then the others for the mechanics.
---

# Analysis workflow — from vague request to report

The end state is always a **case** (`cases/<case>/`) with figures,
pinned data, sidecars, and a report. The pipeline is deterministic in
its *shape*; only the narrative text is improvised.

```
1. RESOLVE RANGE        (nothing is computed without a window — see ladder)
2. BIAS GATE            1H structure → RANGE? stand aside, report that
3. STANDARD CASE        npm run report → 5 charts + data + sidecars
4. ASSEMBLE             sidecars → report-template.html → narrative
5. DELIVER              cases/<case>/report/index.html + verdict
```

## Step 1 — Resolve the time range (the ladder)

Analysis functions require `--start/--end` — **every computation is
windowed by design**. The *user* doesn't have to pick: resolve the
window in this order, anchoring to the DATA, not the clock:

1. **Explicit** — user said a date/window ("August 2025", "last month").
2. **Data-aware default** — probe `GET /api/meta` first; `available`
   gives the true extent `{start, end}`. Default = the most recent
   window sized per the request (e.g. last 30 days) **anchored at
   `available.end`** — never `Date.now()`. This dataset is historical
   (ends 2026-03-03); wall-clock queries return empty data.
3. **Regime-directed** — scan monthly windows with `--fn bias`; pick a
   trending window (long_only/short_only) that actually produces
   setups. Skip if all windows are RANGE.
4. **Event-anchored** — the user mentioned an event/date → window
   around it.

Always state the resolved window explicitly in the summary
("analyzed 2025-08-01 → 2025-09-01 on 1H") so the user can audit it.

## Step 2 — Bias gate

```bash
# CLI (or GET /api/analyze?fn=bias)
npm run analyze -- --fn bias --start … --end … --timeframe 1H
```

- `stand_aside` (RANGE) → **stop**. The answer is "the market is
  ranging; no tradeable structure in this window." Optionally widen/narrow
  the window (Step 1 ladder) before giving up.
- `long_only` / `short_only` → proceed.

## Step 3 — Standard case (one command)

```bash
npm run report -- --start … --end … --timeframe 1H --ltf-timeframe 5m \
    --minRR 1.5 --case <name>
```

Generates deterministically: bias timeline + structure + zones-merged +
liquidity + signal charts, each with sidecar, pinned `data/` bars and
`analysis/` outputs, plus `report/index.html` (template) and
`report/summary.json` (facts). `--minRR 1.5` when the default 2 yields
nothing on a mildly trending window (R:R gate is the selectivity knob).

For a single chart instead, use `npm run chart` (analysis-visualization
skill).

## Step 4 — Assemble the report (the LLM contract)

`npm run report` already fills `report/index.html`: all figures inline
(with captions + sha256 footnotes) and a facts digest in `#report-summary`.
Your job is the **polish**:

1. Read `cases/<name>/report/summary.json` → regime verdict, chart list.
2. Read each sidecar (`charts/<id>.json`) → `caption`, `analysisDigest` —
   quote numbers verbatim when you rewrite `#report-summary`.
3. Edit the digest into a clean narrative; leave the `<figure>` blocks
   as generated (they are the ground truth).

**Quote sidecars verbatim for numbers; narrative words are yours.**
A figure's caption must match its sidecar — never re-derive from pixels.

## Checklist of gotchas

- **Data is historical** — range anchors at `available.end`, not now.
- **Clipping is explicit after the fix**: `/api/range` responses carry
  `clippedFromEnd: true` when the requested end ran past the data, and
  `npm run report` puts `rangeClippedToDataEnd` in `summary.json`.
  A clipped window is sparse data, NOT "the market did nothing" — say so
  in the narrative when adjacent months look empty.
- **RANGE is an answer, not a failure.** `stand_aside` with no signals is
  the system working; say so plainly.
- **`--minRR` gates everything** — see it before declaring "no setups".
- **Deterministic renders** — same query → same bytes; cite
  `sha256`/`sourceCsvSha256` when reproducibility matters.
- **Don't hand-draw figures** — the renderer owns pixels; your job is
  picking which charts to run and writing the narrative.

## Worked example (verified on this dataset)

```
Request: "analyze USTEC recently"
Plan:    probe /api/meta → available ends 2026-03-03
         scan monthly bias on 1H → 2025-08 long_only, 2026-01 short_only
         pick most recent trending window 2026-01-01→2026-02-01
Run:     npm run report -- --start 2026-01-01 --end 2026-02-01 \
             --timeframe 1H --ltf-timeframe 5m --case jan-2026
Deliver: cases/jan-2026/report/index.html
         Summary: LH_LL short bias, N signals, M charts (from summary.json)
```