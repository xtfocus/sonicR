/**
 * Binary-search range helpers over ascending OHLCV bars.
 *
 * Extracted from the data selector tool so the UI tool and the range-query
 * API (`window.ustec`) slice bars identically.
 */

import type { OhlcvBar } from './sonic-r-order-blocks';

/** First index in `bars` with time >= target. */
export function lowerBoundByTime(bars: OhlcvBar[], target: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid]!.time as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in `bars` with time > target. */
export function upperBoundByTime(bars: OhlcvBar[], target: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid]!.time as number) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the bar whose time is closest to `target` (bars ascending). */
export function nearestIndexByTime(bars: OhlcvBar[], target: number): number {
  const upper = upperBoundByTime(bars, target);
  const before = bars[upper - 1];
  const after = bars[upper];
  if (before && after) {
    return Math.abs((before.time as number) - target) <=
      Math.abs((after.time as number) - target)
      ? upper - 1
      : upper;
  }
  return before ? upper - 1 : 0;
}

/** Bars with time in [start, end] (both edges inclusive), ascending. */
export function sliceBarsByTimeRange(
  bars: OhlcvBar[],
  start: number,
  end: number
): OhlcvBar[] {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return bars.slice(lowerBoundByTime(bars, lo), upperBoundByTime(bars, hi));
}
