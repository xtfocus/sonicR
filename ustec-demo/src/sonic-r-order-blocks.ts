import type { UTCTimestamp } from 'lightweight-charts';

/** OHLC + volume (tick volume) for LuxAlgo-style order block detection. */
export type OhlcvBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OrderBlockMitigation = 'wick' | 'close';

export type LuxAlgoOrderBlockOptions = {
  /** Volume pivot length (LuxAlgo `length`). */
  length: number;
  mitigation: OrderBlockMitigation;
};

export type ComputedOrderBlock = {
  side: 'bull' | 'bear';
  top: number;
  bottom: number;
  avg: number;
  /** Bar time of the order-block candle (LuxAlgo box left edge). */
  leftTime: UTCTimestamp;
  /** Bar time where the zone ends: mitigation bar, or last processed bar if still active. */
  rightTime: UTCTimestamp;
};

type ActiveOB = {
  side: 'bull' | 'bear';
  top: number;
  bottom: number;
  avg: number;
  leftTime: UTCTimestamp;
};

const DEFAULT_OPTS: LuxAlgoOrderBlockOptions = {
  length: 5,
  mitigation: 'wick',
};

function rollingMaxHigh(high: number[], i: number, len: number): number {
  let m = -Infinity;
  const from = Math.max(0, i - len + 1);
  for (let j = from; j <= i; j++) m = Math.max(m, high[j]!);
  return m;
}

function rollingMinLow(low: number[], i: number, len: number): number {
  let m = Infinity;
  const from = Math.max(0, i - len + 1);
  for (let j = from; j <= i; j++) m = Math.min(m, low[j]!);
  return m;
}

function rollingMinClose(close: number[], i: number, len: number): number {
  let m = Infinity;
  const from = Math.max(0, i - len + 1);
  for (let j = from; j <= i; j++) m = Math.min(m, close[j]!);
  return m;
}

function rollingMaxHighClose(close: number[], i: number, len: number): number {
  let m = -Infinity;
  const from = Math.max(0, i - len + 1);
  for (let j = from; j <= i; j++) m = Math.max(m, close[j]!);
  return m;
}

/**
 * `ta.pivothigh(volume, length, length)` — pivot confirms at bar `i`, center bar `p = i - length`.
 */
function isPivotHighVolume(vol: number[], i: number, L: number): boolean {
  const p = i - L;
  if (p < L || p > vol.length - 1) return false;
  const vp = vol[p]!;
  for (let k = p - L; k <= p + L; k++) {
    if (k === p) continue;
    if (vol[k]! >= vp) return false;
  }
  return true;
}

function pushCompleted(
  list: ComputedOrderBlock[],
  ob: ActiveOB,
  rightTimeSec: number
): void {
  list.push({
    side: ob.side,
    top: ob.top,
    bottom: ob.bottom,
    avg: ob.avg,
    leftTime: ob.leftTime,
    rightTime: rightTimeSec as UTCTimestamp,
  });
}

/**
 * LuxAlgo-style order blocks up to `endIndex` inclusive.
 * Returns **all** zones: each runs from OB candle time until the mitigation bar, or until `endIndex` if never mitigated.
 */
export function computeLuxAlgoOrderBlocks(
  candles: OhlcvBar[],
  endIndex: number,
  options: Partial<LuxAlgoOrderBlockOptions> = {}
): { bull: ComputedOrderBlock[]; bear: ComputedOrderBlock[] } {
  const opts = { ...DEFAULT_OPTS, ...options };
  const L = opts.length;
  const n = candles.length;
  if (n === 0 || L < 1) return { bull: [], bear: [] };

  const last = Math.max(0, Math.min(endIndex, n - 1));

  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);
  const vol = candles.map((c) => Math.max(0, c.volume));
  const time = candles.map((c) => c.time as number);

  let os = 0;
  const bullActive: ActiveOB[] = [];
  const bearActive: ActiveOB[] = [];
  const bullHistory: ComputedOrderBlock[] = [];
  const bearHistory: ComputedOrderBlock[] = [];

  for (let i = 0; i <= last; i++) {
    if (i >= L) {
      const upper = rollingMaxHigh(high, i, L);
      const lower = rollingMinLow(low, i, L);
      const highPast = high[i - L]!;
      const lowPast = low[i - L]!;
      if (highPast > upper) os = 0;
      else if (lowPast < lower) os = 1;
    }

    let targetBull: number;
    let targetBear: number;
    if (opts.mitigation === 'close') {
      targetBull = rollingMinClose(close, i, L);
      targetBear = rollingMaxHighClose(close, i, L);
    } else {
      targetBull = rollingMinLow(low, i, L);
      targetBear = rollingMaxHigh(high, i, L);
    }

    const phv = i >= 2 * L && isPivotHighVolume(vol, i, L);

    if (phv && os === 1 && i >= L) {
      const p = i - L;
      const hl2 = (high[p]! + low[p]!) / 2;
      const top = hl2;
      const btm = low[p]!;
      const avg = (top + btm) / 2;
      bullActive.unshift({
        side: 'bull',
        top,
        bottom: btm,
        avg,
        leftTime: time[p]! as UTCTimestamp,
      });
    }

    if (phv && os === 0 && i >= L) {
      const p = i - L;
      const hl2 = (high[p]! + low[p]!) / 2;
      const top = high[p]!;
      const btm = hl2;
      const avg = (top + btm) / 2;
      bearActive.unshift({
        side: 'bear',
        top,
        bottom: btm,
        avg,
        leftTime: time[p]! as UTCTimestamp,
      });
    }

    const tMit = time[i]!;
    for (let s = bullActive.length - 1; s >= 0; s--) {
      if (targetBull < bullActive[s]!.bottom) {
        pushCompleted(bullHistory, bullActive[s]!, tMit);
        bullActive.splice(s, 1);
      }
    }
    for (let s = bearActive.length - 1; s >= 0; s--) {
      if (targetBear > bearActive[s]!.top) {
        pushCompleted(bearHistory, bearActive[s]!, tMit);
        bearActive.splice(s, 1);
      }
    }
  }

  const rightEnd = time[last]!;
  for (const ob of bullActive) {
    pushCompleted(bullHistory, ob, rightEnd);
  }
  for (const ob of bearActive) {
    pushCompleted(bearHistory, ob, rightEnd);
  }

  const byLeft = (x: ComputedOrderBlock, y: ComputedOrderBlock) =>
    (x.leftTime as number) - (y.leftTime as number);
  bullHistory.sort(byLeft);
  bearHistory.sort(byLeft);

  return { bull: bullHistory, bear: bearHistory };
}
