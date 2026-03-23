# Sonic R (Sonic R + EMA system) - Lightweight Charts Demo

This document explains the **visual output** currently implemented in `ustec-demo`:
- **Dragon** EMAs (34 period) as 3 lines + filled channel
- **Trend line** EMA89
- **Entry triggers** (BUY / SELL markers) derived from the Sonic R wave + EMA filters
- A **toggle menu** to enable/disable Sonic R overlays

The implementation computes indicator values from the **currently selected timeframe candles** (your app resamples your 1m OHLC into 5m/15m/30m/1H/1D).

---

## How to enable / disable

1. Use the top-left **Indicators** menu.
2. Check **Sonic R** to show the Dragon + EMA89 + entry triggers.
3. Uncheck it to hide them.

---

## Timeframes

Your app resamples the same underlying 1m dataset. When you change the timeframe:
- candles update
- Sonic R is recomputed for that timeframe
- entry triggers update to reflect swings **in the selected timeframe**

This is important because Sonic R is sensitive to candle resolution: the “same move” can look different at 5m vs 1H.

---

## Visual legend (what each clue means)

### 1) Dragon channel (34 EMA)
These are the three EMA lines derived from the TradingView idea:

1. **Blue thin line (Low Dragon)**  
   Computed as `EMA(low, 34)`.  
   Interpretation: dynamic lower support boundary of the Dragon zone.

2. **Blue thin line (High Dragon)**  
   Computed as `EMA(high, 34)`.  
   Interpretation: dynamic upper boundary of the Dragon zone.

3. **Blue thicker line (Center / Close Dragon)**  
   Computed as `EMA(close, 34)`.  
   Interpretation: “center of mass” for the Dragon; often used as the reference when visualizing momentum.

### 2) Filled Dragon channel (between EMA(high,34) and EMA(low,34))
The translucent filled region shows the **Dragon zone**:
- If price is spending more time near/above the filled region, momentum tends to be bullish.
- If price is spending more time below the filled region, momentum tends to be bearish.

In Sonic R style, **slope matters more than absolute position**:
- Rising / upward-tilting channel = bullish bias
- Falling / downward-tilting channel = bearish bias
- Flat = avoid (no clear momentum)

### 3) EMA89 (Trend Line)
The red line is:
- `EMA(close, 89)`

Interpretation (trend filter):
- If price is above EMA89, prefer bullish setups.
- If price is below EMA89, prefer bearish setups.

The trend filter used for entries is based on EMA89.

### 4) Entry triggers (BUY / SELL)
When Sonic R is ON, the chart shows markers on bars where a detected 3-leg wave also satisfies the Sonic R filters.
In particular, the marker is placed on the **first valid breakout candle after Leg 2** (rather than waiting for the wave to fully end).

Rules implemented in this phase (simplified):
1. Wave requirement ("no wave = no trade"): a signal is created only when a detected wave pattern exists.
2. Pullback quality filter (Dragon interaction at Leg 2):
   - BUY wave: Leg 2 low must pull into / near the Dragon band
   - SELL wave: Leg 2 high must pull into / near the Dragon band
3. Trend filter:
   - BUY if `close > EMA(close, 89)`
   - SELL if `close < EMA(close, 89)`
4. Dragon slope filter (center line):
   - BUY if `EMA(close,34)` slope is upward
   - SELL if `EMA(close,34)` slope is downward
   - flat is skipped
   - slope strength must exceed a minimum normalized threshold
5. Trigger rule (using leg1End as the “previous high/low”):
   - BUY if `close >= leg1End.price`
   - SELL if `close <= leg1End.price`
6. No-chop filter:
   - require minimum normalized separation between `EMA(close,34)` and `EMA(close,89)`
   - if they are too close, signal is rejected as likely range/chop

### Threshold details (current defaults in code)
- **Slope strength**:
  - computed as `abs(EMA34[i] - EMA34[i-1]) / abs(close)`
  - must be >= `0.00015` to qualify
- **No-chop (EMA separation)**:
  - computed as `abs(EMA34[i] - EMA89[i]) / abs(close)`
  - must be >= `0.0006` to qualify

These markers are based on the currently selected timeframe.

---

## Known behavior / limitations (current phase)

1. **Wave detection is pivot-based.**  
It is sensitive to the pivot window size (relative to bars). When you change timeframe, the pivot sensitivity changes accordingly.

2. **Signals can cluster.**  
Because waves can overlap, you may see multiple entry markers close together.

3. **This is not yet full Sonic R rule-set.**  
The entry logic here is the first simplified version; filters and triggers can be refined next.

---

## Why markers should remain visible while zooming

If you previously noticed markers disappearing while zooming, that was due to marker scaling.
The markers are now configured to participate in autoscaling (`autoScale: true`) so they stay visible after zoom operations.

