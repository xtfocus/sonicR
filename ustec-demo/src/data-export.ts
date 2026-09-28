/**
 * CSV / Markdown export helpers for the data selector tool.
 *
 * Filename rule: <SYMBOL>_<TIMEFRAME>_<START>_<END>.csv with compact sortable
 * UTC stamps, e.g. USTEC_5m_20250901T0930_20250905T1600.csv
 *
 * All timestamps are UTC, matching the source CSV's convention. The volume
 * column is tick volume (TICKVOL in the MT5 export).
 */

import type { UTCTimestamp } from 'lightweight-charts';
import type { OhlcvBar } from './sonic-r-order-blocks';

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD HH:MM:SS' in UTC. */
export function formatBarTime(sec: number): string {
  const d = new Date(sec * 1000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Compact sortable UTC stamp for filenames: 'YYYYMMDDTHHMM'. */
export function formatCompactTime(sec: number): string {
  const d = new Date(sec * 1000);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

/**
 * Descriptive auto-generated filename:
 * <symbol>_<timeframe>_<start>_<end>.csv
 */
export function buildCsvFilename(
  symbol: string,
  timeframeLabel: string,
  range: { start: UTCTimestamp; end: UTCTimestamp }
): string {
  return `${symbol}_${timeframeLabel}_${formatCompactTime(range.start)}_${formatCompactTime(
    range.end
  )}.csv`;
}

/** Comma-separated OHLCV with header: time,open,high,low,close,tickvol. */
export function barsToCsv(bars: OhlcvBar[]): string {
  const lines: string[] = ['time,open,high,low,close,tickvol'];
  for (const b of bars) {
    lines.push(
      `${formatBarTime(b.time as number)},${b.open},${b.high},${b.low},${b.close},${b.volume ?? 0}`
    );
  }
  return lines.join('\n');
}

/**
 * Markdown table of the bars, titled with the given header line
 * (summary with symbol, timeframe, bar count and range).
 */
export function barsToMarkdown(bars: OhlcvBar[], header: string): string {
  const lines: string[] = [
    header,
    '',
    '| time | open | high | low | close | tickvol |',
    '|---|---|---|---|---|---|',
  ];
  for (const b of bars) {
    lines.push(
      `| ${formatBarTime(b.time as number)} | ${b.open} | ${b.high} | ${b.low} | ${b.close} | ${
        b.volume ?? 0
      } |`
    );
  }
  return lines.join('\n');
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Clipboard write; resolves false instead of throwing (e.g. no permission). */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
