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
| `src/main.ts` | Toolbar button, Escape key handling, `effectiveDataset()` (replay-aware data source), refresh hooks on renders. |

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
