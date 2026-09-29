/**
 * CLI for the analysis function registry — the terminal twin of
 * `GET /api/analyze`. Same time formats and semantics as `npm run query`.
 *
 *   npm run analyze -- --fn pivots --start 2025-09-01 --end 2025-10-01 --timeframe 1H
 *   npm run analyze -- --fn signal --start 2025-11-01 --end 2025-12-01 \
 *       --timeframe 1H --ltf-timeframe 5m --minRR 2.5
 *   npm run analyze -- --list [--lang vi]
 *
 * Flags `--fn`, `--start`, `--end`, `--timeframe`, `--ltf-timeframe`,
 * `--format`, `--csv`, `--lang`, `--list`, `--help` are consumed by the
 * CLI; every other flag is forwarded to the function as a parameter
 * (declared in `src/analysis/registry.ts`; bare flags mean `true`).
 */

import { loadApi } from './dataset';
import { parseFlagArgs } from './parse-args';
import {
  analyzeFunctions,
  describeAnalyzeFunctions,
  getAnalyzeFunction,
  runAnalyze,
} from '../analysis/registry';
import type { AnalysisResult } from '../analysis/types';

const USAGE = `Usage: npm run analyze -- --fn <id> --start <time> --end <time> [options]

  --fn <id>            analysis function (see --list)
  --start, --end       required; epoch seconds, 'YYYY-MM-DD[ T]HH:MM[:SS]' (UTC),
                       date-only, or ISO 8601 with timezone (…Z / …±HH:MM)
  --timeframe <tf>     label ('5m', '1H', …) or seconds; default 5m
  --ltf-timeframe <tf> trigger timeframe for 'signal' (default 5m)
  --format <fmt>       json (default) or csv — csv writes tabular data rows
  --csv <path>         source CSV override (default public/data copy)
  --lang <en|vi>       language for --list summaries
  --list               list available functions and parameters
  --help               show this help

  Any other flag is forwarded to the function, e.g. --k 12 --bodyOnly
  (bare boolean flags mean true)`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const CONTROL_FLAGS = new Set([
  'fn',
  'start',
  'end',
  'timeframe',
  'ltf-timeframe',
  'format',
  'csv',
  'lang',
  'list',
  'help',
]);

const args = parseFlagArgs(process.argv.slice(2));

if (args.has('help')) {
  console.log(USAGE);
  process.exit(0);
}

if (args.has('list')) {
  const lang = args.get('lang') === 'vi' ? 'vi' : 'en';
  console.log(JSON.stringify(describeAnalyzeFunctions(lang), null, 2));
  process.exit(0);
}

const fnId = args.get('fn');
if (!fnId) fail('--fn is required (or use --list)');
const fnDef = getAnalyzeFunction(fnId);
if (!fnDef) {
  fail(`unknown --fn '${fnId}'. Available: ${analyzeFunctions.map((f) => f.id).join(', ')}`);
}

const start = args.get('start');
const end = args.get('end');
if (!start || !end) fail('--start and --end are required');

// Forward every non-control flag to the registry as a raw parameter.
const rawParams: Record<string, string> = {};
for (const [key, value] of args) {
  if (!CONTROL_FLAGS.has(key)) rawParams[key] = value;
}

const api = loadApi(args.get('csv'));
let result;
try {
  const htf = api.queryRange(start, end, {
    timeframe: args.get('timeframe') ?? undefined,
  });
  const ltfTimeframe = args.get('ltf-timeframe');
  const ltf =
    fnDef.needsLtf || ltfTimeframe != null
      ? api.queryRange(start, end, { timeframe: ltfTimeframe ?? undefined })
      : undefined;
  result = runAnalyze(
    fnId,
    {
      bars: htf.bars,
      intervalSeconds: htf.intervalSeconds,
      ltfBars: ltf?.bars,
      ltfIntervalSeconds: ltf?.intervalSeconds,
    },
    rawParams
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const format = args.get('format') ?? 'json';
if (format === 'csv') {
  console.log(toCsvRows(result));
} else if (format !== 'json') {
  fail(`invalid --format '${format}' (json or csv)`);
} else {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Flatten a result envelope to CSV: one header union + one row per item of
 * the widest array found under `data` (zones, pivots, events, signals, …).
 * Scalar results (bias) print as `key,value` rows.
 */
function toCsvRows(result: AnalysisResult<unknown>): string {
  const data = result.data as Record<string, unknown>;
  let widest: unknown[] | null = null;
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && (widest === null || value.length > widest.length)) widest = value;
  }
  if (!widest) {
    return Object.entries(data)
      .map(([key, value]) => `${key},${JSON.stringify(value)}`)
      .join('\n');
  }
  const rows = widest as Array<Record<string, unknown>>;
  const headers = new Set<string>();
  for (const row of rows) {
    for (const key of flattenKeys(row)) headers.add(key);
  }
  const head = [...headers].join(',');
  const body = rows.map((row) => {
    const flat: Record<string, string> = {};
    collectFlat(row, '', flat);
    return [...headers].map((h) => flat[h] ?? '').join(',');
  });
  return [head, ...body].join('\n');
}

function flattenKeys(row: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, name));
    } else {
      keys.push(name);
    }
  }
  return keys;
}

function collectFlat(row: Record<string, unknown>, prefix: string, out: Record<string, string>): void {
  for (const [key, value] of Object.entries(row)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      collectFlat(value as Record<string, unknown>, name, out);
    } else {
      out[name] = value == null ? '' : Array.isArray(value) ? value.join(';') : String(value);
    }
  }
}
