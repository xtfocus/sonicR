/**
 * Node-side query core shared by the HTTP API (serve.ts) and the CLI (cli.ts).
 *
 * Loads the source CSV once, resamples every timeframe and exposes the exact
 * same RangeQueryApi as the browser page. Server-side there is no replay
 * cursor: queries always see the full dataset.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseUstecCsv,
  resampleOhlcSkipEmptyBuckets,
  TIMEFRAMES,
  USTEC_CSV_FILENAME,
} from '../ustec-data';
import { createRangeQueryApi } from '../range-query-api';
import type { RangeQueryApi } from '../range-query-api';

/** Chart default when no timeframe is requested. */
const DEFAULT_INTERVAL_SECONDS = 300;

const defaultCsvPath = fileURLToPath(
  new URL(`../../public/data/${USTEC_CSV_FILENAME}`, import.meta.url)
);

/** Build the query API; `csvPath` overrides the bundled public/data file. */
export function loadApi(csvPath = process.env.USTEC_CSV ?? defaultCsvPath): RangeQueryApi {
  const bars = parseUstecCsv(readFileSync(csvPath, 'utf8'));
  const byInterval = new Map(
    TIMEFRAMES.map((tf) => [tf.seconds, resampleOhlcSkipEmptyBuckets(bars, tf.seconds)])
  );
  return createRangeQueryApi({
    symbol: 'USTEC',
    timeframes: TIMEFRAMES,
    getDataset: (intervalSeconds) => byInterval.get(intervalSeconds) ?? [],
    getActiveIntervalSeconds: () => DEFAULT_INTERVAL_SECONDS,
    getSelection: () => null,
  });
}
