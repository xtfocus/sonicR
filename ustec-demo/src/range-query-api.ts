/**
 * Programmatic range-query API over the chart's effective datasets.
 *
 * main.ts exposes the created object as `window.ustec`. Queries return the
 * same bars the UI data selector would export for the same range
 * (replay-aware WYSIWYG): while replay mode is active, bars after the replay
 * cursor are never returned.
 *
 *   - UTC epoch seconds:       1756724400
 *   - CSV convention (UTC):    '2025-09-01 09:30' | '2025-09-01 09:30:45'
 *     (space or 'T' separator, seconds optional)
 *   - date-only (UTC midnight): '2025-09-01'
 *   - ISO 8601 with timezone:  '2025-09-01T09:30:00Z' | '2025-09-01T11:30:00+02:00'
 *
 * 'YYYY-MM-DD[ T]HH:MM[:SS]' is always read as UTC. Other ISO forms without
 * a timezone designator are rejected: Date.parse would silently read them as
 * local time.
 */

import type { UTCTimestamp } from 'lightweight-charts';
import type { OhlcvBar } from './sonic-r-order-blocks';
import { sliceBarsByTimeRange } from './bar-range';
import { barsToCsv, formatBarTime } from './data-export';

export type TimeInput = number | string;

export interface RangeQueryTimeframe {
  label: string;
  seconds: number;
}

export interface RangeQueryResult {
  symbol: string;
  /** Timeframe label, e.g. '5m'. */
  timeframe: string;
  intervalSeconds: number;
  /** Requested bounds, normalized to UTC seconds (lo before hi). */
  requested: { start: number; end: number };
  /** 'YYYY-MM-DD HH:MM:SS' UTC of the first/last returned bar; null when empty. */
  from: string | null;
  to: string | null;
  barCount: number;
  /** Bars with time in [requested.start, requested.end], ascending. */
  bars: OhlcvBar[];
  /** Full extent of the queried (effective) dataset, UTC seconds; null when empty. */
  available: { start: number; end: number } | null;
  /**
   * True when the requested end ran past `available.end` — the returned
   * bars are clipped at the data's last bar. Prevents a sparse/empty
   * window from looking like "the market did nothing".
   */
  clippedFromEnd: boolean;
}

export interface RangeQueryOptions {
  /** Timeframe label ('5m', '1H', …) or interval seconds; defaults to the active one. */
  timeframe?: string | number;
  /** Max bars returned, taken from the start of the range; positive integer. */
  limit?: number;
}

export interface RangeQueryDeps {
  symbol: string;
  timeframes: RangeQueryTimeframe[];
  /** Effective (replay-aware) dataset for a timeframe, ascending by time. */
  getDataset: (intervalSeconds: number) => OhlcvBar[];
  getActiveIntervalSeconds: () => number;
  /** Current UI selection range, or null. */
  getSelection: () => { start: UTCTimestamp; end: UTCTimestamp } | null;
}

export interface RangeQueryApi {
  timeframes: RangeQueryTimeframe[];
  /** Parse a time argument to UTC seconds; null when invalid. */
  parseTime: (input: TimeInput) => number | null;
  queryRange: (
    start: TimeInput,
    end: TimeInput,
    opts?: RangeQueryOptions
  ) => RangeQueryResult;
  /** Re-query the current UI selection in the same shape; null when none. */
  getSelection: () => RangeQueryResult | null;
  /** Serialize a result exactly like the UI's Export CSV payload. */
  toCsv: (result: RangeQueryResult) => string;
  /**
   * Browser-only: snapshot the current chart (WYSIWYG, replay-aware) to
   * a titled PNG, trigger a download and return the data URL. Provided
   * by main.ts; absent on the Node-side API.
   */
  capturePng?: (opts?: { title?: string }) => string;
}

declare global {
  interface Window {
    ustec: RangeQueryApi;
  }
}

// 'YYYY-MM-DD[ T]HH:MM[:SS]' — all read as UTC (source CSV convention).
const UTC_STYLE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
// Full ISO 8601 requires an explicit timezone before we trust Date.parse.
const ISO_WITH_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Parse a time argument to UTC seconds; null when invalid. */
export function parseTimeInput(input: TimeInput): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const s = input.trim();
  const m = UTC_STYLE.exec(s);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m;
    const secs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) / 1000;
    return Number.isFinite(secs) ? secs : null;
  }
  if (ISO_WITH_TZ.test(s)) {
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) return ms / 1000;
  }
  return null;
}

export function createRangeQueryApi(deps: RangeQueryDeps): RangeQueryApi {
  const tfBySeconds = new Map(deps.timeframes.map((tf) => [tf.seconds, tf]));
  const labels = () => deps.timeframes.map((tf) => tf.label).join(', ');

  function resolveTimeframe(tf?: string | number): RangeQueryTimeframe {
    if (tf == null) {
      const seconds = deps.getActiveIntervalSeconds();
      return tfBySeconds.get(seconds) ?? { label: `${seconds}s`, seconds };
    }
    if (typeof tf === 'number') {
      const hit = tfBySeconds.get(tf);
      if (!hit) throw new Error(`Unknown timeframe seconds: ${tf}. Available: ${labels()}`);
      return hit;
    }
    const key = tf.trim().toLowerCase();
    const hit = deps.timeframes.find(
      (t) => t.label.toLowerCase() === key || String(t.seconds) === key
    );
    if (!hit) throw new Error(`Unknown timeframe: '${tf}'. Available: ${labels()}`);
    return hit;
  }

  function requireTime(which: string, input: TimeInput): number {
    const t = parseTimeInput(input);
    if (t == null) {
      throw new Error(
        `Invalid ${which} time: ${JSON.stringify(input)}. Use UTC epoch seconds, ` +
          "'YYYY-MM-DD HH:MM[:SS]' (UTC), or ISO 8601 with timezone (…Z / …±HH:MM)."
      );
    }
    return t;
  }

  function buildResult(
    tf: RangeQueryTimeframe,
    startSec: number,
    endSec: number,
    limit?: number
  ): RangeQueryResult {
    const dataset = deps.getDataset(tf.seconds);
    const matched = sliceBarsByTimeRange(dataset, startSec, endSec);
    const bars = limit == null ? matched : matched.slice(0, limit);
    const first = bars[0];
    const last = bars[bars.length - 1];
    const available =
      dataset.length > 0
        ? {
            start: dataset[0]!.time as number,
            end: dataset[dataset.length - 1]!.time as number,
          }
        : null;
    return {
      symbol: deps.symbol,
      timeframe: tf.label,
      intervalSeconds: tf.seconds,
      requested: { start: Math.min(startSec, endSec), end: Math.max(startSec, endSec) },
      from: first ? formatBarTime(first.time as number) : null,
      to: last ? formatBarTime(last.time as number) : null,
      barCount: bars.length,
      bars,
      available,
      // Truth the caller would otherwise have to infer: the requested end
      // ran past the data, so the returned bars are clipped at
      // available.end. Sparse/empty windows stay explicit instead of
      // looking like "the market did nothing".
      clippedFromEnd: available != null && Math.max(startSec, endSec) > available.end,
    };
  }

  return {
    timeframes: deps.timeframes,
    parseTime: parseTimeInput,
    queryRange(start, end, opts) {
      if (opts?.limit != null && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
        throw new Error(`Invalid limit: ${JSON.stringify(opts.limit)}. Use a positive integer.`);
      }
      const tf = resolveTimeframe(opts?.timeframe);
      return buildResult(tf, requireTime('start', start), requireTime('end', end), opts?.limit);
    },
    getSelection() {
      const sel = deps.getSelection();
      if (!sel) return null;
      const seconds = deps.getActiveIntervalSeconds();
      const tf = tfBySeconds.get(seconds) ?? { label: `${seconds}s`, seconds };
      return buildResult(tf, sel.start as number, sel.end as number);
    },
    toCsv: (result) => barsToCsv(result.bars),
  };
}
