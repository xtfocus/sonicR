# Order blocks (LuxAlgo-style)

This demo implements an **order block (OB) detector** aligned with the LuxAlgo *Order Block Detector* approach (volume pivot + regime + mitigation). It is integrated as an optional layer under **Sonic R** in the indicators menu.

## Attribution

The original TradingView / Pine reference script is **© LuxAlgo**, licensed under **CC BY-NC-SA 4.0**. This TypeScript port reproduces the same *logic shape* for local backtesting and visualization; it is not an official LuxAlgo product.

## Where it lives

| Piece | Role |
|--------|------|
| `src/sonic-r-order-blocks.ts` | Computes bull/bear zones from OHLCV: pivot state, zone geometry, mitigation, full history. |
| `src/order-blocks-primitive.ts` | Draws semi-transparent rectangles plus a dashed **mid** line at the zone average price. |
| `src/indicators/sonicR-indicator.ts` | Toggles OBs, runs the compute for the active timeframe, attaches the pane primitive. |
| `src/main.ts` | Loads **tick volume** from the CSV (column 7), aggregates volume when resampling higher timeframes. |

## How to enable

1. Turn on **Sonic R** in the indicators list.  
2. Under Sonic R, check **Order blocks (LuxAlgo OB)**.

Without tick volume, pivots degenerate (ties at zero volume), so zones will rarely or never form. The USTEC loader reads **TICKVOL** into each bar’s `volume` field.

## Algorithm (summary)

Parameters default to **`length = 5`** and **`mitigation = 'wick'`** (see `DEFAULT_OPTS` in `sonic-r-order-blocks.ts`).

### 1. Volume pivot (`ta.pivothigh(volume, length, length)`)

At bar index `i`, a **pivot high** on volume is confirmed when the volume at bar `p = i - length` is **strictly greater** than every other volume in `[p - length, p + length]`. If there is a tie, it is not treated as a pivot.

### 2. Regime `os` (order state)

Using the same `length` window:

- Compare **`high[i - length]`** to the rolling maximum of **`high`** over the **last `length` bars** ending at `i` (i.e. bars `i - length + 1 … i`). If the older high is greater → **`os = 0`**.
- Else compare **`low[i - length]`** to the rolling minimum of **`low`** over that same window. If the older low is lower → **`os = 1`**.
- Otherwise **`os`** carries forward.

### 3. Forming a zone

When the volume pivot fires at `i` **and** `os` matches the side:

- **Bullish OB** (`os === 1`): zone from **`hl2`** to **`low`** on bar `p` (`hl2 = (high + low) / 2` of that bar).
- **Bearish OB** (`os === 0`): zone from **`high`** to **`hl2`** on bar `p`.

The zone’s **left edge** in time is the timestamp of bar `p`.

### 4. Mitigation

Two modes exist in code; the default is **wick**:

- **Wick**:  
  - Bull zones invalidate when **`ta.lowest(low, length)`** (over the last `length` bars at the current bar) drops **below** the zone bottom.  
  - Bear zones invalidate when **`ta.highest(high, length)`** rises **above** the zone top.
- **Close**: same idea using **`lowest(close, length)`** / **`highest(close, length)`** instead of wick extremes.

When a zone is mitigated, its **right edge** in time is set to the **mitigation bar’s** time.

### 5. Historical vs active

The implementation keeps **every** zone from creation until either:

- it is **mitigated** (right time = mitigation bar), or  
- the simulation **ends** at the last bar you are viewing (including replay “now”), in which case still-active zones extend their **right** edge to that bar.

Bull and bear lists are sorted by **`leftTime`** for stable drawing.

## Visualization

- **Bull**: green tint, **bear**: red tint (see `order-blocks-primitive.ts` for current RGBA values).  
- Each zone is a **filled rectangle** from `leftTime` → `rightTime` between top and bottom price, with a **dashed horizontal line** at the **average** of top and bottom.  
- Opacity is intentionally low so price action and Sonic R elements remain readable.

## Replay and timeframes

- OBs are recomputed from the **full** resampled series for the selected timeframe, but only **through the bar at or before** the current replay time (so mitigation state matches history up to “now”).  
- Higher timeframes aggregate **sum of tick volume** per bucket when resampling from 1m data.

## Limitations / differences

- **Strict** volume pivot ties may differ slightly from TradingView’s exact tie-breaking.  
- Drawing many historical zones can be heavy on large ranges; the code does not yet clip to the visible time range.  
- This is an educational/visual tool, not a trading recommendation.
