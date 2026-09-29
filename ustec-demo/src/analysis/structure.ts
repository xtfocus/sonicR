/**
 * Structure layer: confirmed swing pivots (the zigzag), labelled legs,
 * market-structure classification, BOS/CHoCH events and leg equilibriums.
 *
 * This module reifies the Sonic R workflow as pure functions:
 *
 * 1. `findPivots`     — the zigzag (fractal via the `k` parameter)
 * 2. `labelLegs`      — the cosmetic A→B→C… view
 * 3. `classifyStructure` — HH/HL vs LH/LL vs RANGE (the HTF bias input)
 * 4. `detectBos` / `detectChoch` — continuation / reversal events
 * 5. `legEquilibriums` — 50% levels the Sonic R entry model trades around
 *
 * Everything is evaluated on *bar closes* and keyed off `confirmedAt`, so
 * results are identical whether computed live or replayed (no repaint).
 */

import type {
  BosEvent,
  ChochEvent,
  Dir,
  Leg,
  OhlcvBar,
  Pivot,
  StructureKind,
} from './types';

/**
 * Bar `i` is a pivot high when `high[i]` is **strictly greater** than the
 * highs of the `k` bars on both sides. Ties resolve to the earlier bar
 * (strict `>` against later bars, strict `>` against earlier bars is not
 * required — an equal earlier high simply cannot be surpassed quietly).
 *
 * Atomic predicate — exported for testing and reuse.
 */
export function isPivotHigh(highs: number[], i: number, k: number): boolean {
  if (i < k || i + k >= highs.length) return false;
  const h = highs[i]!;
  for (let j = i - k; j <= i + k; j++) {
    if (j !== i && highs[j]! >= h) return false;
  }
  return true;
}

/** Mirror of {@link isPivotHigh} for lows (strictly lower than neighbours). */
export function isPivotLow(lows: number[], i: number, k: number): boolean {
  if (i < k || i + k >= lows.length) return false;
  const l = lows[i]!;
  for (let j = i - k; j <= i + k; j++) {
    if (j !== i && lows[j]! <= l) return false;
  }
  return true;
}

/**
 * Find all confirmed swing pivots — the zigzag backbone.
 *
 * A pivot needs `k` bars on each side, so the last `k` bars can never
 * confirm one; `confirmedAt` records when each pivot became knowable
 * (close of the k-th right-side bar, bounded by the final input bar).
 * Two pivots of the same kind keep the more extreme one *only when
 * adjacent* — consecutive same-kind candidates are collapsed so the
 * returned array strictly alternates high/low.
 *
 * @param bars    Ascending OHLCV bars (one timeframe, any provider).
 * @param k       Confirmation window in bars each side; ≥ 1. Bigger `k`
 *                = HTF swing structure, smaller = internal/LTF structure.
 *                This single knob is what makes the analysis fractal.
 */
export function findPivots(bars: OhlcvBar[], k: number): Pivot[] {
  const n = bars.length;
  if (n === 0 || k < 1) return [];
  const interval = n > 1 ? bars[1]!.time - bars[0]!.time : 0;

  const raw: Pivot[] = [];
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const confirmTime = (i: number): number => {
    const last = bars[n - 1]!;
    const t = bars[Math.min(i + k, n - 1)]!.time;
    // A confirmation "close" is the open of the next bar; never exceed data.
    return Math.min(t + interval, last.time + interval);
  };

  for (let i = k; i < n - k; i++) {
    const bar = bars[i]!;
    if (isPivotHigh(highs, i, k)) {
      raw.push({ index: i, time: bar.time, price: bar.high, kind: 'high', confirmedAt: confirmTime(i) });
    } else if (isPivotLow(lows, i, k)) {
      raw.push({ index: i, time: bar.time, price: bar.low, kind: 'low', confirmedAt: confirmTime(i) });
    }
  }

  // Collapse consecutive same-kind pivots, keeping the most extreme.
  const collapsed: Pivot[] = [];
  for (const p of raw) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.kind === p.kind) {
      const keepHigh = p.kind === 'high' ? p.price > prev.price : p.price < prev.price;
      if (keepHigh) collapsed[collapsed.length - 1] = p;
    } else {
      collapsed.push(p);
    }
  }
  return collapsed;
}

const LEG_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Label consecutive zigzag legs A, B, C, … between alternating pivots.
 *
 * Pure presentation — the letters carry no Elliott-style semantics; they
 * reproduce the "price goes A→D→F, never A→Z in one leg" mental model.
 */
export function labelLegs(pivots: Pivot[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < pivots.length; i++) {
    const from = pivots[i - 1]!;
    const to = pivots[i]!;
    legs.push({
      label: LEG_LABELS[(i - 1) % LEG_LABELS.length]!,
      dir: to.price > from.price ? 'bull' : 'bear',
      from: { time: from.time, price: from.price, kind: from.kind },
      to: { time: to.time, price: to.price, kind: to.kind },
      delta: to.price - from.price,
      equilibrium: (from.price + to.price) / 2,
    });
  }
  return legs;
}

/**
 * Classify market structure over the last `lookback` pivots.
 *
 * - `HH_HL`  — uptrend: higher highs **and** higher lows dominate
 * - `LH_LL`  — downtrend: lower highs and lower lows dominate
 * - `RANGE`  — mixed: no side dominates (trade nothing, per the model)
 *
 * Dominance = majority of comparable consecutive pivot pairs; ties and
 * short histories fall back to `RANGE`.
 */
export function classifyStructure(pivots: Pivot[], lookback = 6): StructureKind {
  const window = pivots.slice(-Math.max(2, lookback));
  let hh = 0;
  let lh = 0;
  let hl = 0;
  let ll = 0;
  // Pivots strictly alternate high/low, so comparable pairs are two apart.
  for (let i = 2; i < window.length; i++) {
    const a = window[i - 2]!;
    const b = window[i]!;
    if (b.kind === 'high') {
      b.price > a.price ? hh++ : lh++;
    } else {
      b.price > a.price ? hl++ : ll++;
    }
  }
  const up = hh + hl;
  const down = lh + ll;
  if (up === 0 && down === 0) return 'RANGE';
  if (hh >= lh && hl >= ll && up > down) return 'HH_HL';
  if (lh >= hh && ll >= hl && down > up) return 'LH_LL';
  return 'RANGE';
}

/**
 * Detect break-of-structure events: a bar **close** beyond the most recent
 * confirmed pivot on the same side, evaluated in pivot order.
 *
 * BOS confirms *continuation*: a close above the last swing high extends
 * the bull leg; a close below the last swing low extends the bear leg.
 * Only pivots already confirmed at the breaking bar's time count — the
 * level must have been knowable when it broke.
 */
export function detectBos(bars: OhlcvBar[], pivots: Pivot[]): BosEvent[] {
  return detectStructureBreaks(bars, pivots).filter((e): e is BosEvent => e.kind === 'bos');
}

/**
 * Detect change-of-character events: the first close against the
 * prevailing leg after a sequence of with-trend breaks.
 *
 * CHoCH is the LTF *trigger* in the entry model: after price arrives at a
 * POI, the internal CHoCH is what fires the entry.
 */
export function detectChoch(bars: OhlcvBar[], pivots: Pivot[]): ChochEvent[] {
  return detectStructureBreaks(bars, pivots).filter((e): e is ChochEvent => e.kind === 'choch');
}

/** First bar index with `time >= target`, or -1 when past the last bar. */
function firstIndexAtOrAfter(bars: OhlcvBar[], target: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid]!.time as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : -1;
}

/**
 * Shared engine for BOS/CHoCH.
 *
 * Walks confirmed pivots; for each pivot, finds the first bar closing
 * beyond it (above for highs, below for lows) at or after the pivot's
 * `confirmedAt`. Emits `bos` while the break agrees with the current
 * trend leg and `choch` for the first break against it, which then flips
 * the tracked leg.
 */
function detectStructureBreaks(bars: OhlcvBar[], pivots: Pivot[]): Array<BosEvent | ChochEvent> {
  const events: Array<BosEvent | ChochEvent> = [];
  let trend: Dir | null = null; // prevailing leg direction

  for (const pivot of pivots) {
    // Only levels confirmed by the data can be broken.
    // First bar whose close is at/after the pivot's confirmation time —
    // only from there can a break of this level be knowable. Binary
    // search: bars ascend by time, confirmedAt is a bar-open time.
    const startIdx = firstIndexAtOrAfter(bars, pivot.confirmedAt);
    if (startIdx < 0) continue;

    for (let i = startIdx; i < bars.length; i++) {
      const bar = bars[i]!;
      const breaksUp = pivot.kind === 'high' && bar.close > pivot.price;
      const breaksDown = pivot.kind === 'low' && bar.close < pivot.price;
      if (!breaksUp && !breaksDown) continue;

      const dir: Dir = breaksUp ? 'bull' : 'bear';
      const base = { level: pivot.price, time: bar.time, index: i };
      if (trend === null || dir === trend) {
        events.push({ kind: 'bos', dir, ...base });
      } else {
        events.push({ kind: 'choch', dir, ...base });
      }
      trend = dir;
      break; // this level is consumed; move to the next pivot
    }
  }
  return events;
}

/**
 * Equilibrium (50%) levels for the last `count` labelled legs — the Sonic R
 * midpoints retracements are traded against.
 */
export function legEquilibriums(pivots: Pivot[], count = 3): Leg['equilibrium'][] {
  return labelLegs(pivots)
    .slice(-Math.max(1, count))
    .map((leg) => leg.equilibrium);
}
