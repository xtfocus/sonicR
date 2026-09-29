---
name: technical-analysis
description: >
  Use when asked to analyze OHLCV market data (USTEC or any candle series)
  using the technical-analysis utilities: computing swing structure,
  zigzag pivots, BOS/CHoCH events, zones (FVG, order blocks,
  supply/demand), liquidity, directional bias, or composite entry
  signals. The utilities implement the Sonic R top-down methodology —
  HTF structure first, internal structure second, confluence zones third.
  Each function is callable from the CLI and the HTTP API, and outputs
  strict JSON for notebooks and AI agents.
---

# Technical analysis utilities

A set of callable functions for technical analysis over candle (OHLCV)
data. Every function is:

- **Pure and point-in-time safe** — input is bars + numeric parameters,
  output is JSON. No lookahead: a function only ever uses information
  that was knowable at the time it reports. Results are identical whether
  computed live or replayed.
- **Composable** — three layers (structure → zones → signals) that build
  on each other; higher layers call lower ones for you.
- **Fractal** — one parameter, `k`, scales the zigzag between swing
  (HTF) and internal (LTF) structure. Bigger `k` = larger structure.

## Getting started

```bash
# Start the HTTP API (once per session)
npm run serve-api                    # http://localhost:5200, --port to change

# Or use the CLI directly — no server needed
npm run analyze -- --list            # catalogue (add --lang vi for Vietnamese)
```

Data: a 1-minute USTEC (Nasdaq 100) feed, 2025-08-01 → 2026-03-03, all
timestamps UTC. Timeframes available: `1m`, `5m`, `15m`, `30m`, `1H`,
`1D` (default `5m`); higher ones are resampled from the 1m source.

**Time arguments** (`--start`, `--end`): epoch seconds, `'YYYY-MM-DD
[ T]HH:MM[:SS]'` (always UTC), date-only `'YYYY-MM-DD'` (UTC midnight),
or ISO 8601 with timezone. Both are required on every call.

## Calling the functions

CLI (spaces, `--flag value`; bare booleans mean `true`):

```bash
npm run analyze -- --fn <function> --start <time> --end <time> \
    [--timeframe 1H] [--param value …]
```

HTTP (same semantics; `ltfTimeframe` for multi-timeframe calls):

```bash
curl 'http://localhost:5200/api/analyze?fn=<function>&start=…&end=…&timeframe=1H&<param>=value'
curl 'http://localhost:5200/api/functions'       # machine-readable catalogue
```

Every call returns the same result envelope:

```json
{
  "fn": "structure",
  "intervalSeconds": 3600,
  "barCount": 1474,
  "from": 1756684800,
  "to": 1764547200,
  "data": { … }
}
```

`barCount`/`from`/`to` tell you exactly what was evaluated — check them
before interpreting `data`.

## Layer 1 — Structure (what the market *is* doing)

| Function | Parameters (default) | Returns |
|---|---|---|
| `pivots` | `k` (5) | Confirmed swing pivots + labeled zigzag legs A→B→C — the internal "price goes A→D→F, never A→Z in one leg" view. |
| `structure` | `k` (5), `lookback` (6) | Classification: `HH_HL` (uptrend), `LH_LL` (downtrend), `RANGE`, plus the recent legs it was computed from. |
| `bos` | `k` (5) | Break-of-structure events — closes beyond the last confirmed swing; continuation. |
| `choch` | `k` (5) | Change-of-character events — the first close against the prevailing leg; the reversal trigger. |
| `equilibrium` | `k` (5), `count` (3) | 50% retracement levels of the most recent legs (Sonic R midpoints). |

## Layer 2 — Zones (where the market *reacted*)

| Function | Parameters (default) | Returns |
|---|---|---|
| `fvg` | `minGap` (0) | Fair-value gaps (3-bar imbalances). |
| `order-blocks` | `k` (5), `maxLookback` (10), `bodyOnly` (false) | Zones anchored to breaks of structure (`bodyOnly` = candle body instead of full range). |
| `supply-demand` | `k` (5), `baseBars` (3) | Consolidation bases right before confirmed pivot highs/lows — the coarsest map. |
| `zones-merged` | `k` (5), `maxLookback` (10), `baseBars` (3), `minGap` (0) | All three zone kinds merged into points of interest; `provenance` lists which kinds overlap. |
| `liquidity` | `k` (5), `tolerance` (0.001) | Old extremes + clusters of equal highs/lows — where price is drawn to. |

Every zone carries a **lifecycle state**:

| State | Meaning | Tradeable? |
|---|---|---|
| `fresh` | Never revisited since formed | ✅ |
| `touched` | Wick test, closed back out | ✅ |
| `mitigated` | A close landed inside the zone (imbalance filled) | ⚠️ conservative models stand down |
| `broken` | A close went through the far edge | ❌ |

`firstTouch` / `invalidatedAt` give the exact times. On merged zones,
`provenance: ['OB','FVG']` means **one** POI backed by two distinct
logics — count distinct logics, not zone instances; `confluenceCount`
already does this for you.

## Layer 3 — Signals (what to *do*)

| Function | Parameters (default) | Returns |
|---|---|---|
| `bias` | `k` (5) | `long_only` / `short_only` / `stand_aside` (range). |
| `pois` | `k` (5), `includeMitigated` (false), `limit` (5) | Bias-filtered, still-tradeable POIs nearest to price. |
| `signal` | `htfK` (5), `ltfK` (3), `minRR` (2), `stopBuffer` (0.0005), `limit` (3) | Full setups: entry, stop, ranked targets, R:R. |

## The analysis workflow

The methodology the utilities implement is strictly top-down — run the
layers in order; each is a decision gate:

1. **Bias first, on the HTF** (`--timeframe 1H` or `1D`):
   ```bash
   npm run analyze -- --fn bias --start 2025-08-01 --end 2025-09-01 --timeframe 1H
   ```
   `stand_aside` ⇒ the market is ranging — stop here and report that.
   No signals exist in a range by design.

2. **Context** (`--fn structure` for the legs, `--fn pivots` for the
   zigzag, `--fn liquidity` for targets) on the same HTF.

3. **Zone map** (`--fn zones-merged`, HTF): longs take bull zones below
   price; shorts take bear zones above; ignore `broken`/`mitigated`.

4. **Composite check** (`--fn signal`): reproduces steps 1–3 internally,
   then requires price to arrive at the POI and an internal CHoCH (on
   the LTF) to fire after arrival, then filters by minimum R:R.

```bash
# whole pipeline on one call: HTF = 1H, trigger series = 5m
npm run analyze -- --fn signal --start 2026-01-01 --end 2026-02-01 \
    --timeframe 1H --ltf-timeframe 5m --minRR 1.5
```

### Reading a signal

```
bull entry=23212.0 stop=23165.0 rr=1.96 targets=[23304.2,23508.1,23566.5]
```

- `entry` — the POI near edge (limit order level).
- `stop` — beyond the POI far edge, plus `stopBuffer` (0.05%).
- `targets` — opposing liquidity levels, nearest first.
- `rr` — reward of the first target over risk; `null` when no target.

## Practical guidance

- **`k` scales with timeframe.** Treat it as the "zoom" of structure:
  ~5 on 1H, ~3 on 5m, larger on D1. Internal structure is the same
  function at a smaller `k` — that's the whole fractality model.
- **Verify bias before expecting signals.** A `signal` call on a ranging
  window legitimately returns `signals: []`. This dataset varies:
  `2025-08` → long, `2025-11` → long, `2026-01` → short, while
  `2025-09…12` ranged. Check `--fn bias` first.
- **Widen or narrow the window to get fresh zones.** On a busy month,
  most zones end `broken` (price consumed them). For fresh/tradeable
  zones, look at the last 2–4 weeks.
- **`minRR` is the selectivity knob.** Default 2. Raise for fewer,
  higher-quality setups; lower (1.5) to see borderline ones.
- **`--bodyOnly`, `--includeMitigated`** are booleans — passing the bare
  flag means `true`.
- **Errors are informative.** Unknown function/parameter or bad values
  produce an error listing what is accepted — on the HTTP API as
  `400 { "error": … }`.

## Worked example (verified)

```bash
npm run analyze -- --fn signal --start 2025-08-01 --end 2025-09-01 \
    --timeframe 1H --ltf-timeframe 5m --minRR 1.5
```

Result:

```
bias:  long_only  | pois: 2 | signals: 1
bull entry=23212.0 stop=23165.0 rr=1.96 targets=[23304.2,23508.1,23566.5] prov=['OB'] conf=1
```

Interpretation: HTF structure was `HH_HL` (long-only bias); among the
confluence POIs, the order-block zone 23176.6–23212.0 survived the
filters; price arrived, a 5m CHoCH fired, and the nearest liquidity
target gave R:R 1.96 — a single-logic long setup.

## Troubleshooting

| Symptom | Check / fix |
|---|---|
| `signals: []` | Bias is `stand_aside`, or every POI is `broken`/`mitigated`. Run `bias` and `zones-merged` to see which; widen the window or lower `minRR`. |
| `Unknown function 'x'` | Ids are lowercase with hyphens (`order-blocks`, not `orderBlocks`). Run `--list`. |
| `Unknown parameter 'y'` | The error lists the accepted parameters for that function. |
| All zones `broken` or `mitigated` | Window too long — price consumed them. Narrow to the recent 2–4 weeks. |
| HTTP 400 with `{ error }` | Same validation as the CLI, in the response body. |
| Need Vietnamese output | `--lang vi` on `--list` / `?lang=vi` on `/api/functions`. |