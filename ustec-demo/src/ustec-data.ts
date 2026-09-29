/**
 * USTEC data pipeline shared by the browser app (main.ts) and the Node tools
 * (HTTP API + CLI in src/node/): source filename, timeframe catalogue, CSV
 * parsing and OHLC resampling. Pure — no DOM or Node APIs.
 */

import type { UTCTimestamp } from 'lightweight-charts';
import type { OhlcvBar } from './sonic-r-order-blocks';
import type { RangeQueryTimeframe } from './range-query-api';

/** Served at /data/<file> in the browser; on disk at public/data/<file>. */
export const USTEC_CSV_FILENAME = 'USTEC_M1_202508010000_202603031408.csv';

/**
 * The app's timeframe catalogue (label + interval seconds). Single source for
 * the chart's timeframe selector, the window.ustec API and the Node tools.
 */
export const TIMEFRAMES: RangeQueryTimeframe[] = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '1H', seconds: 3600 },
  { label: '1D', seconds: 86400 },
];

function parseDateToUtcSeconds(dateStr: string, timeStr: string): number {
  // dateStr = "2025.08.01" -> y, m, d
  const [y, m, d] = dateStr.split('.').map(Number);
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  return Math.floor(ms / 1000);
}

/**
 * Parse the MT5 tab-separated export. Columns: <DATE> <TIME> <OPEN> <HIGH>
 * <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>; dates as 2025.08.01, UTC.
 */
export function parseUstecCsv(text: string): OhlcvBar[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const rows: OhlcvBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split('\t');
    if (cols.length < 6) continue;
    const [date, time, open, high, low, close] = cols;
    const tickVol = cols[6] != null && cols[6] !== '' ? parseFloat(cols[6]) : 0;
    rows.push({
      time: parseDateToUtcSeconds(date!, time!) as UTCTimestamp,
      open: parseFloat(open!),
      high: parseFloat(high!),
      low: parseFloat(low!),
      close: parseFloat(close!),
      volume: Number.isFinite(tickVol) ? tickVol : 0,
    });
  }
  return rows;
}

/**
 * Resample 1m bars to `intervalSeconds` buckets. lightweight-charts expects
 * `time` to be increasing, so buckets with no underlying candle are skipped.
 */
export function resampleOhlcSkipEmptyBuckets(
  data1m: OhlcvBar[],
  intervalSeconds: number
): OhlcvBar[] {
  if (intervalSeconds <= 60) return data1m;

  const buckets = new Map<number, OhlcvBar[]>();

  for (const c of data1m) {
    const t = c.time as number;
    const bucketStart = Math.floor(t / intervalSeconds) * intervalSeconds;
    const arr = buckets.get(bucketStart);
    if (arr) arr.push(c);
    else buckets.set(bucketStart, [c]);
  }

  const bucketStarts = Array.from(buckets.keys()).sort((a, b) => a - b);
  const result: OhlcvBar[] = [];

  for (const bucketStart of bucketStarts) {
    const arr = buckets.get(bucketStart)!;
    // assumes input is ordered; if it's not, you'd need to sort `arr` by time here.
    const open = arr[0].open!;
    const close = arr[arr.length - 1].close!;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const x of arr) {
      high = Math.max(high, x.high!);
      low = Math.min(low, x.low!);
      volume += x.volume ?? 0;
    }

    result.push({
      time: bucketStart as UTCTimestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return result;
}
