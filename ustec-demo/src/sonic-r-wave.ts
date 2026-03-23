import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

export type PivotKind = 'high' | 'low';

export type Pivot = {
  index: number;
  time: UTCTimestamp;
  price: number;
  kind: PivotKind;
};

export type WaveDirection = 'bull' | 'bear';

export type WavePattern = {
  direction: WaveDirection;
  // Sonic R 3-leg structure endpoints:
  // Bull: Leg1 impulse ends at High, Leg2 pullback ends at Low, Leg3 breakout ends at High
  // Bear: Leg1 impulse ends at Low,  Leg2 pullback ends at High, Leg3 breakout ends at Low
  leg1Start: Pivot;
  leg1End: Pivot;
  leg2End: Pivot;
  leg3End: Pivot;
};

function findPivots(
  candles: CandlestickData[],
  leftBars: number,
  rightBars: number
): Pivot[] {
  const pivots: Pivot[] = [];
  const n = candles.length;
  if (n === 0) return pivots;

  const highs = candles.map((c) => c.high as number);
  const lows = candles.map((c) => c.low as number);

  const from = leftBars;
  const to = n - rightBars; // exclusive upper bound for i

  for (let i = from; i < to; i++) {
    const hi = highs[i]!;
    let isHigh = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      // Strict pivot: higher than every neighbor.
      if (highs[j]! >= hi) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      pivots.push({
        index: i,
        time: candles[i]!.time as UTCTimestamp,
        price: hi,
        kind: 'high',
      });
    }

    const lo = lows[i]!;
    let isLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      // Strict pivot: lower than every neighbor.
      if (lows[j]! <= lo) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      pivots.push({
        index: i,
        time: candles[i]!.time as UTCTimestamp,
        price: lo,
        kind: 'low',
      });
    }
  }

  // Order by index (time axis).
  pivots.sort((a, b) => a.index - b.index);
  return pivots;
}

function findNextPivotIndex(
  pivots: Pivot[],
  start: number,
  kind: PivotKind
): number {
  for (let i = start; i < pivots.length; i++) {
    if (pivots[i]!.kind === kind) return i;
  }
  return -1;
}

export function computeSonicRWavePatterns(
  candles: CandlestickData[],
  pivotLeftBars: number,
  pivotRightBars: number
): WavePattern[] {
  if (candles.length === 0) return [];

  const pivots = findPivots(candles, pivotLeftBars, pivotRightBars);
  if (pivots.length < 4) return [];

  const patterns: WavePattern[] = [];

  // Bull scanning: low -> high -> low -> high
  for (let i = 0; i < pivots.length; i++) {
    if (pivots[i]!.kind !== 'low') continue;
    const idxHigh1 = findNextPivotIndex(pivots, i + 1, 'high');
    if (idxHigh1 === -1) break;

    const idxLow2 = findNextPivotIndex(pivots, idxHigh1 + 1, 'low');
    if (idxLow2 === -1) break;

    const idxHigh2 = findNextPivotIndex(pivots, idxLow2 + 1, 'high');
    if (idxHigh2 === -1) break;

    const leg1Start = pivots[i]!;
    const leg1End = pivots[idxHigh1]!;
    const leg2End = pivots[idxLow2]!;
    const leg3End = pivots[idxHigh2]!;

    // Impulse up + pullback + breakout
    if (leg1End.price <= leg1Start.price) continue;
    if (leg2End.price >= leg1End.price) continue; // pullback should be below impulse high
    if (leg3End.price <= leg1End.price) continue; // breakout should exceed impulse high

    patterns.push({
      direction: 'bull',
      leg1Start,
      leg1End,
      leg2End,
      leg3End,
    });

    // Skip ahead past breakout to avoid excessive overlaps.
    i = idxHigh2;
  }

  // Bear scanning: high -> low -> high -> low
  for (let i = 0; i < pivots.length; i++) {
    if (pivots[i]!.kind !== 'high') continue;
    const idxLow1 = findNextPivotIndex(pivots, i + 1, 'low');
    if (idxLow1 === -1) break;

    const idxHigh2 = findNextPivotIndex(pivots, idxLow1 + 1, 'high');
    if (idxHigh2 === -1) break;

    const idxLow3 = findNextPivotIndex(pivots, idxHigh2 + 1, 'low');
    if (idxLow3 === -1) break;

    const leg1Start = pivots[i]!;
    const leg1End = pivots[idxLow1]!;
    const leg2End = pivots[idxHigh2]!;
    const leg3End = pivots[idxLow3]!;

    // Impulse down + pullback + breakout down
    if (leg1End.price >= leg1Start.price) continue;
    if (leg2End.price <= leg1End.price) continue; // pullback should be above impulse low
    if (leg3End.price >= leg1End.price) continue; // breakout should be below impulse low

    patterns.push({
      direction: 'bear',
      leg1Start,
      leg1End,
      leg2End,
      leg3End,
    });

    i = idxLow3;
  }

  // Most recent first (useful for rendering caps).
  patterns.sort((a, b) => b.leg3End.index - a.leg3End.index);
  return patterns;
}

