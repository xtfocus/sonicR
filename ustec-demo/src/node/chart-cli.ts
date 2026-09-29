/**
 * CLI for chart rendering — the terminal twin of `GET /api/chart`.
 *
 *   npm run chart -- --fn signal --start 2025-08-01 --end 2025-09-01 \
 *       --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --session aug-long
 *
 * Runs the analysis + renders + saves the PNG **with a sidecar manifest**
 * under `reports/<session>/` (the LLM figure library), then prints the
 * artifact record as JSON. `--out stdout` prints raw PNG bytes instead
 * (for piping); `--format svg|spec` selects the output format.
 *
 * Flags consumed by the CLI itself: --fn --start --end --timeframe
 * --ltf-timeframe --session --title --width --height --dpi --theme
 * --format --out --csv --help. Everything else is forwarded as an
 * analysis parameter (same coercion as the analysis CLI).
 */

import { writeFileSync } from 'node:fs';
import { loadApi } from './dataset';
import { parseFlagArgs, parseFlagArgsAll } from './parse-args';
import { buildChart, CHART_FNS } from './chart-core';
import { saveChart } from './artifacts';
import { renderPng } from '../viz/png';
import { renderSvg } from '../viz/svg';
import { parseAnnotations } from '../viz/annotate';

const USAGE = `Usage: npm run chart -- --fn <id> --start <time> --end <time> [options]

  --fn <id>            chart function: ${CHART_FNS.join(' | ')}
  --start, --end       required; same time formats as npm run analyze
  --timeframe <tf>     label ('5m', '1H', …) or seconds; default 5m
  --ltf-timeframe <tf> trigger series for 'signal' (default 5m)
  --session <name>     reports/<name>/ directory for PNG + sidecar (default 'default')
  --title <text>       chart title override
  --width/--height     canvas pixels (default 1600x900); --dpi default 2
  --theme <dark|light> palette (default dark)
  --format <fmt>       png (default) | svg | spec
  --out <path|stdout>  write elsewhere; 'stdout' pipes raw bytes
  --csv <path>         source CSV override
  --help               show this help
  --annotate <spec>     repeatable freeform annotation, e.g.
                       --annotate 'level@24600@watch' --annotate 'text@2025-09-08 14:00,26250@note'
                       kinds: level vline marker text zone (@-separated; see src/viz/annotate.ts)
  Other flags are forwarded to the analysis (e.g. --k 8 --minRR 1.5)`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const CONTROL = new Set([
  'fn', 'start', 'end', 'timeframe', 'ltf-timeframe', 'session', 'title',
  'width', 'height', 'dpi', 'theme', 'format', 'out', 'csv', 'help', 'annotate',
]);

const allArgs = parseFlagArgsAll(process.argv.slice(2));
const args = parseFlagArgs(process.argv.slice(2));
if (args.has('help')) {
  console.log(USAGE);
  process.exit(0);
}

const fn = args.get('fn');
const start = args.get('start');
const end = args.get('end');
if (!fn || !start || !end) fail('--fn, --start and --end are required');

const params: Record<string, string> = {};
for (const [key, value] of args) {
  if (!CONTROL.has(key)) params[key] = value;
}
const annotations = (allArgs.get('annotate') ?? []).filter((v) => v !== '');

const width = args.get('width') != null ? Number(args.get('width')) : undefined;
const height = args.get('height') != null ? Number(args.get('height')) : undefined;
const dpi = args.get('dpi') != null ? Number(args.get('dpi')) : undefined;
const themeArg = args.get('theme');
if (themeArg != null && themeArg !== '' && themeArg !== 'dark' && themeArg !== 'light') {
  fail(`invalid --theme '${themeArg}' (dark or light)`);
}
if (width != null && !Number.isFinite(width)) fail('invalid --width');
if (height != null && !Number.isFinite(height)) fail('invalid --height');
if (dpi != null && !Number.isFinite(dpi)) fail('invalid --dpi');

const api = loadApi(args.get('csv'));
let outcome;
try {
  outcome = buildChart(api, {
    fn,
    start,
    end,
    timeframe: args.get('timeframe') ?? undefined,
    ltfTimeframe: args.get('ltf-timeframe') ?? undefined,
    params,
    title: args.get('title') ?? undefined,
    layout: {
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      ...(dpi != null ? { dpi } : {}),
      ...(themeArg === 'dark' || themeArg === 'light' ? { theme: themeArg } : {}),
    },
  });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (annotations.length > 0) {
  try {
    outcome.spec.overlays.push(...parseAnnotations(annotations, (s) => api.parseTime(s)));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

const format = args.get('format') ?? 'png';
const out = args.get('out');

if (format === 'spec') {
  console.log(JSON.stringify(outcome.spec, null, 2));
} else if (format === 'svg') {
  process.stdout.write(renderSvg(outcome.spec));
} else if (format !== 'png') {
  fail(`invalid --format '${format}' (png, svg or spec)`);
} else {
  const rendered = renderPng(outcome.spec, {
    width: outcome.spec.layout?.width ?? 1600,
    height: outcome.spec.layout?.height ?? 900,
  });
  if (out === 'stdout') {
    process.stdout.write(rendered.png);
  } else if (out != null && out !== '') {
    writeFileSync(out, rendered.png);
    console.log(JSON.stringify({ file: out, bytes: rendered.png.length, caption: outcome.caption }, null, 2));
  } else {
    const record = saveChart({
      session: args.get('session') ?? 'default',
      rendered,
      spec: outcome.spec,
      caption: outcome.caption,
      start,
      end,
      ltfTimeframe: args.get('ltf-timeframe') ?? undefined,
      analysisDigest: outcome.signal
        ? {
            bias: outcome.signal.bias,
            pois: outcome.signal.pois.length,
            signals: outcome.signal.signals,
          }
        : undefined,
    });
    console.log(JSON.stringify(record, null, 2));
  }
}
