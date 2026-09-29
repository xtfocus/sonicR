/**
 * CLI twin of window.ustec — query bars without a browser.
 *
 *   npm run query -- --start '2025-09-01 09:30' --end '2025-09-02' \
 *       [--timeframe 1H] [--limit 10] [--format json|csv]
 *
 * Same time formats and semantics as the page API. Server-side there is no
 * replay cursor: queries always see the full dataset.
 */

import { loadApi } from './dataset';
import { parseFlagArgs } from './parse-args';

const USAGE = `Usage: npm run query -- --start <time> --end <time> [options]

  --start, --end    required; epoch seconds, 'YYYY-MM-DD[ T]HH:MM[:SS]' (UTC),
                    date-only, or ISO 8601 with timezone (…Z / …±HH:MM)
  --timeframe <tf>  label ('5m', '1H', …) or seconds; default 5m
  --limit <n>       max rows, taken from the start of the range
  --format <fmt>    json (default) or csv
  --csv <path>      source CSV override (default public/data copy)
  --help            show this help`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const args = parseFlagArgs(process.argv.slice(2));
if (args.has('help')) {
  console.log(USAGE);
  process.exit(0);
}

const start = args.get('start');
const end = args.get('end');
if (!start || !end) fail('--start and --end are required');

const limitRaw = args.get('limit');
const limit =
  limitRaw == null ? undefined : /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
if (limitRaw != null && limit == null) fail(`invalid --limit '${limitRaw}' (positive integer)`);

const format = args.get('format') ?? 'json';
const api = loadApi(args.get('csv'));
let result;
try {
  result = api.queryRange(start, end, {
    timeframe: args.get('timeframe'),
    limit,
  });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
console.log(format === 'csv' ? api.toCsv(result) : JSON.stringify(result, null, 2));
