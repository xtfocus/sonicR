import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

export type LinePoint = { time: UTCTimestamp; value: number };

export type DragonFillPoint = {
  time: UTCTimestamp;
  lowValue: number;
  highValue: number;
};

export type SonicRComputed = {
  emaLow34: LinePoint[];
  emaHigh34: LinePoint[];
  emaClose34: LinePoint[];
  ema89: LinePoint[];
  dragonFillPoints: DragonFillPoint[];

  // Raw EMA arrays aligned to candle indices (undefined means "not seeded yet").
  emaLow34Raw: Array<number | undefined>;
  emaHigh34Raw: Array<number | undefined>;
  emaClose34Raw: Array<number | undefined>;
  ema89Raw: Array<number | undefined>;
};

/**
 * EMA seeded with SMA(period) for TradingView-like behavior.
 * Returns an array aligned with `values` where undefined means "not seeded yet".
 */
export function ema(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);

  // Seed with SMA of first `period` samples.
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }

  return out;
}

export function computeSonicRFromCandles(candles: CandlestickData[]): SonicRComputed {
  const lows = candles.map((c) => c.low as number);
  const highs = candles.map((c) => c.high as number);
  const closes = candles.map((c) => c.close as number);

  const emaLow34Raw = ema(lows, 34);
  const emaHigh34Raw = ema(highs, 34);
  const emaClose34Raw = ema(closes, 34);
  const ema89Raw = ema(closes, 89);

  const emaLow34: LinePoint[] = [];
  const emaHigh34: LinePoint[] = [];
  const emaClose34: LinePoint[] = [];
  const ema89: LinePoint[] = [];
  const dragonFillPoints: DragonFillPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const t = candles[i]!.time as UTCTimestamp;

    const el = emaLow34Raw[i];
    if (el != null) emaLow34.push({ time: t, value: el });

    const eh = emaHigh34Raw[i];
    if (eh != null) emaHigh34.push({ time: t, value: eh });

    const ec = emaClose34Raw[i];
    if (ec != null) emaClose34.push({ time: t, value: ec });

    const e89 = ema89Raw[i];
    if (e89 != null) ema89.push({ time: t, value: e89 });

    if (el != null && eh != null) {
      dragonFillPoints.push({ time: t, lowValue: el, highValue: eh });
    }
  }

  return {
    emaLow34,
    emaHigh34,
    emaClose34,
    ema89,
    dragonFillPoints,
    emaLow34Raw,
    emaHigh34Raw,
    emaClose34Raw,
    ema89Raw,
  };
}

