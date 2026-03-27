import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { SonicRComputed } from './sonic-r-ema';
import type { WavePattern } from './sonic-r-wave';

export type SonicRSignal = {
  time: UTCTimestamp;
  price: number;
  side: 'buy' | 'sell';
  debug?: {
    close: number;
    ema89: number;
    leg1Price: number;
    slope: number;
    slopeStrength: number;
    emaSeparation: number;
    minSlopeStrength: number;
    minEmaSeparation: number;
  };
};

// Minimum normalized EMA34 slope strength (fraction of price).
// Example: 0.00015 = 0.015% per bar.
const MIN_SLOPE_STRENGTH = 0.00015;

// Minimum normalized distance between EMA34 and EMA89 to avoid chop.
// Example: 0.0006 = 0.06% of price.
const MIN_EMA_SEPARATION = 0.0006;

function getRawAtIndex(arr: Array<number | undefined>, index: number): number | undefined {
  if (index < 0 || index >= arr.length) return undefined;
  return arr[index];
}

function passesPullbackDragonInteraction(
  wave: WavePattern,
  sonic: SonicRComputed
): boolean {
  const leg2Index = wave.leg2End.index;
  const dragonLow = getRawAtIndex(sonic.emaLow34Raw, leg2Index);
  const dragonHigh = getRawAtIndex(sonic.emaHigh34Raw, leg2Index);
  if (dragonLow == null || dragonHigh == null) return false;

  // Tolerance scales with Dragon width, plus a small absolute floor.
  const dragonWidth = Math.abs(dragonHigh - dragonLow);
  const tolerance = Math.max(dragonWidth * 0.35, 1.0);

  if (wave.direction === 'bull') {
    // Bull pullback endpoint is a LOW pivot. We require it to pull into/near Dragon.
    // "Near" means no higher than top of Dragon + tolerance.
    return wave.leg2End.price <= dragonHigh + tolerance;
  }

  // Bear pullback endpoint is a HIGH pivot. We require it to pull into/near Dragon.
  // "Near" means no lower than bottom of Dragon - tolerance.
  return wave.leg2End.price >= dragonLow - tolerance;
}

/**
 * Computes entry triggers using:
 * - Trend filter: EMA89(close)
 * - Dragon slope filter: EMA(close,34) slope (center line)
 * - Pullback quality filter: Leg 2 must interact with Dragon zone
 * - Wave filter: only signal on the end of a detected 3-leg wave
 * - Trigger condition: bull breakout uses leg1End price as "previous high" rule; bear uses leg1End as "previous low"
 */
export function computeSonicREntries(
  candles: CandlestickData[],
  sonic: SonicRComputed,
  waves: WavePattern[]
): SonicRSignal[] {
  if (candles.length === 0) return [];

  const signalsByTime = new Map<number, SonicRSignal>();

  // Precedence: most recent waves first (main already sorts waves that way).
  for (const w of waves) {
    const leg2Index = w.leg2End.index;
    const leg3Index = w.leg3End.index;
    const leg1Price = w.leg1End.price;
    if (leg2Index < 0 || leg3Index < 0 || leg2Index >= candles.length) continue;

    // Pullback quality: require Leg 2 to interact with (or get close to) Dragon.
    if (!passesPullbackDragonInteraction(w, sonic)) continue;

    // Entry timing fix: fire at first valid breakout candle after Leg 2,
    // rather than waiting for Leg 3 endpoint.
    const startIndex = Math.max(leg2Index + 1, 0);
    const endIndex = Math.min(leg3Index, candles.length - 1);
    if (startIndex > endIndex) continue;

    for (let i = startIndex; i <= endIndex; i++) {
      const candle = candles[i];
      if (!candle || candle.close == null) continue;

      const close = candle.close as number;
      const time = candle.time as UTCTimestamp;

      // Avoid duplicates: if a later wave already created a signal at this time, skip.
      if (signalsByTime.has(time as number)) continue;

      const ema89 = getRawAtIndex(sonic.ema89Raw, i);
      const emaClose34 = getRawAtIndex(sonic.emaClose34Raw, i);
      const emaClose34Prev = getRawAtIndex(sonic.emaClose34Raw, i - 1);
      if (ema89 == null || emaClose34 == null || emaClose34Prev == null) continue;

      const slope = emaClose34 - emaClose34Prev;
      const denom = Math.max(Math.abs(close), 1e-9);
      const slopeStrength = Math.abs(slope) / denom;
      const slopeUp = slope > 0;
      const slopeDown = slope < 0;
      if (!slopeUp && !slopeDown) continue; // flat => avoid
      if (slopeStrength < MIN_SLOPE_STRENGTH) continue; // slope too weak

      // No-chop filter: require enough EMA34-vs-EMA89 separation.
      const emaSeparation = Math.abs(emaClose34 - ema89) / denom;
      if (emaSeparation < MIN_EMA_SEPARATION) continue;

      if (w.direction === 'bull') {
        // Trigger: first close that breaks "previous high" (leg1 end)
        if (close < leg1Price) continue;
        // Trend filter: price above EMA89
        if (close <= ema89) continue;
        // Dragon bias: upward slope
        if (!slopeUp) continue;

        signalsByTime.set(time as number, {
          time,
          price: close,
          side: 'buy',
          debug: {
            close,
            ema89,
            leg1Price,
            slope,
            slopeStrength,
            emaSeparation,
            minSlopeStrength: MIN_SLOPE_STRENGTH,
            minEmaSeparation: MIN_EMA_SEPARATION,
          },
        });
        break;
      } else {
        // Trigger: first close that breaks "previous low" (leg1 end)
        if (close > leg1Price) continue;
        // Trend filter: price below EMA89
        if (close >= ema89) continue;
        // Dragon bias: downward slope
        if (!slopeDown) continue;

        signalsByTime.set(time as number, {
          time,
          price: close,
          side: 'sell',
          debug: {
            close,
            ema89,
            leg1Price,
            slope,
            slopeStrength,
            emaSeparation,
            minSlopeStrength: MIN_SLOPE_STRENGTH,
            minEmaSeparation: MIN_EMA_SEPARATION,
          },
        });
        break;
      }
    }
  }

  return Array.from(signalsByTime.values()).sort((a, b) => (a.time as number) - (b.time as number));
}

