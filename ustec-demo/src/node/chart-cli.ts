/**
 * CLI for chart rendering — the terminal twin of `GET /api/chart`.
 *
 *   npm run chart -- --fn signal --start 2025-08-01 --end 2025-09-01 \
 *       --timeframe 1H --ltf-timeframe 5m --minRR 1.5 --case aug-long
 *
 * Runs the analysis + renders + saves the PNG **with a case manifest**
 * under `cases/<case>/` (the LLM figure library): the exact bars are
 * pinned to `data/`, the analysis output to `analysis/`, charts to
 * `charts/`. `--out stdout` prints raw PNG bytes; `--format svg|spec`
 * selects the output format; `--spec spec.json` renders an agent-authored
 * ChartSpec directly (no analysis run).
 *
 * Flags consumed by the CLI itself: --fn --start --end --timeframe
 * --ltf-timeframe --session (alias --case) --spec --title --width --height
 * --dpi --theme --format --out --csv --help. Everything else is forwarded
 * as an analysis parameter (same coercion as the analysis CLI).
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { loadApi } from './dataset';
import { parseFlagArgs, parseFlagArgsAll } from './parse-args';
import { buildChart, CHART_FNS } from './chart-core';
import type { ChartOutcome } from './chart-core';
import { persistChartOutcome } from './case-writer';
import { renderPng } from '../viz/png';
import { renderSvg } from '../viz/svg';
import { parseAnnotations } from '../viz/annotate';
import type { ChartSpec } from '../viz/types';

const USAGE = `Usage: npm run chart -- --fn <id> --start <time> --end <time> [options]

  --fn <id>            chart function: ${CHART_FNS.join(' | ')}
  --start, --end       required; same time formats as npm run analyze
  --timeframe <tf>     label ('5m', '1H', …) or seconds; default 5m
  --ltf-timeframe <tf> trigger series for 'signal' (default 5m)
  --case <name>        cases/<name>/ directory for PNG + sidecar + pinned data
                       (alias: --session; default 'default')
  --spec <path>        render an agent-authored ChartSpec JSON instead of
                       running a chart function (no analysis)
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
  'fn', 'start', 'end', 'timeframe', 'ltf-timeframe', 'session', 'case', 'spec', 'title',
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
let outcome: ChartOutcome;
const specPath = args.get('spec');
try {
  if (specPath != null && specPath !== '') {
    // Agent-authored spec: any ChartSpec JSON renders as-is
    // (--annotate still applies on top). No analysis runs. The shape is
    // guard-checked below; the cast is the typed trust boundary after it.
    const raw = JSON.parse(readFileSync(specPath, 'utf8')) as unknown;
    if (isChartSpec(raw)) {
      outcome = { spec: raw, caption: raw.meta.title ?? 'custom spec', bars: raw.bars };
    } else {
      fail('--spec must be a ChartSpec JSON: { meta, bars, overlays?, layout? }');
    }
  } else {
    if (!fn || !start || !end) fail('--fn, --start and --end are required (or use --spec)');
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
  }
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
    const record = persistChartOutcome({
      caseId: args.get('case') ?? args.get('session') ?? 'default',
      outcome,
      fn,
      start,
      end,
      ltfTimeframe: args.get('ltf-timeframe') ?? undefined,
      csvPath: args.get('csv') ?? undefined,
    });
    console.log(JSON.stringify(record, null, 2));
  }
}

/** Minimal shape guard for external ChartSpec JSON (see the cast above). */
function isChartSpec(value: unknown): value is ChartSpec {
  if (typeof value !== 'object' || value == null) return false;
  const spec = value as Partial<ChartSpec>;
  return Array.isArray(spec.bars) && spec.meta != null && typeof spec.meta.symbol === 'string';
}