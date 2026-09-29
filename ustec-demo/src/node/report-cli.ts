/**
 * Deterministic report driver — `npm run report`.
 *
 * Runs the **standard case** for a time range in one command: bias scan
 * (monthly windows), the four core charts (structure, zones-merged,
 * liquidity, signal) plus the bias timeline, pins everything into
 * `cases/<case>/` with data + analysis snapshots, copies the report
 * template into `report/`, and writes `report/summary.json` — the facts
 * an LLM quotes when it writes the narrative.
 *
 *   npm run report -- --start 2025-08-01 --end 2025-09-01 \
 *       [--timeframe 1H] [--ltf-timeframe 5m] [--case name] [--csv path]
 *
 * The agent/human's job after this command: read `report/summary.json`
 * and the sidecars, fill `report/index.html` with the narrative. The
 * figures themselves are guaranteed present and consistent.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadApi } from './dataset';
import { parseFlagArgs } from './parse-args';
import { buildChart } from './chart-core';
import { persistChartOutcome } from './case-writer';
import { caseDirPath, readCaseManifest, setCaseSourceHash } from './artifacts';
import { sourceCsvSha256 } from './dataset';
import { marketBias } from '../analysis/signal';
import { biasTimeline } from '../viz/coverage';
import { renderPng } from '../viz/png';
import { saveChart, type ArtifactRecord } from './artifacts';

const TEMPLATE_PATH = fileURLToPath(new URL('../../report-template.html', import.meta.url));

/** Escape HTML in captions/digest inserted into the report page. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Number of qualifying signals in a chart sidecar's digest (0 when absent). */
function countSignals(record: ArtifactRecord | undefined): number {
  const digest = record?.analysisDigest as { signals?: unknown } | undefined;
  const signals = digest?.signals;
  return Array.isArray(signals) ? signals.length : 0;
}

const USAGE = `Usage: npm run report -- --start <time> --end <time> [options]

  --start, --end       required; same time formats as npm run analyze
  --timeframe <tf>     analysis timeframe (default 1H)
  --ltf-timeframe <tf> signal trigger series (default 5m)
  --k <n>              pivot window for all charts (default 5)
  --minRR <n>          signal selectivity (default 2; e.g. 1.5 for more setups)
  --case <name>        cases/<name>/ (default report-<range>)
  --csv <path>         source CSV override
  --help               show this help`;

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

const timeframe = args.get('timeframe') ?? '1H';
const ltfTimeframe = args.get('ltf-timeframe') ?? '5m';
const api = loadApi(args.get('csv'));
const kArg = args.get('k');
const minRRArg = args.get('minRR');
const k = kArg != null && kArg !== '' ? kArg : undefined;
const minRR = minRRArg != null && minRRArg !== '' ? minRRArg : undefined;
const extraParams: Record<string, string> = {
  ...(k != null ? { k } : {}),
  ...(minRR != null ? { minRR } : {}),
};
const caseId =
  args.get('case') ?? `report-${start.replace(/[^0-9]/g, '')}-${end.replace(/[^0-9]/g, '')}`;

console.log(`Building case '${caseId}' for ${start} → ${end} on ${timeframe}…`);

// 1. Bias scan on monthly windows within the range → the timeline chart
//    and the regime verdict for the summary.
const htfAll = api.queryRange(start, end, { timeframe });
const windows: Array<{ label: string; bars: ReturnType<typeof api.queryRange>['bars'] }> = [];
let cursor = api.parseTime(start);
const endSec = api.parseTime(end);
if (cursor == null || endSec == null) fail('invalid start/end time');
while (cursor != null && cursor <= endSec) {
  const d: Date = new Date(cursor * 1000);
  const nextMonth: number = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  const windowEnd = Math.min(nextMonth, endSec);
  const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const bars = api.queryRange(cursor, windowEnd, { timeframe }).bars;
  if (bars.length > 0) windows.push({ label, bars });
  // Stop once the window we just processed reached (or passed) the
  // requested end. NOTE: must compare `nextMonth`, not `cursor ===
  // windowEnd` — the naive check fires on the FIRST iteration whenever
  // endSec sits exactly on a month boundary (cursor === windowEnd),
  // truncating the scan to one window.
  cursor = nextMonth;
  if (nextMonth >= endSec) break;
}
const regime = marketBias(htfAll.bars, 5);
console.log(`Regime: ${regime.structure} → ${regime.bias} (${windows.length} monthly window(s))`);

// 2. The standard chart set, persisted via the shared case writer.
const core: Array<{ fn: string; build: () => ReturnType<typeof buildChart> }> = [
  { fn: 'structure', build: () => buildChart(api, { fn: 'structure', start, end, timeframe, params: { ...extraParams } }) },
  { fn: 'zones-merged', build: () => buildChart(api, { fn: 'zones-merged', start, end, timeframe, params: { ...extraParams } }) },
  { fn: 'liquidity', build: () => buildChart(api, { fn: 'liquidity', start, end, timeframe, params: { ...extraParams } }) },
  {
    fn: 'signal',
    build: () =>
      buildChart(api, { fn: 'signal', start, end, timeframe, ltfTimeframe, params: { ...extraParams } }),
  },
];

const chartRecords = core.map(({ fn, build }) => {
  const outcome = build();
  const record = persistChartOutcome({
    caseId,
    outcome,
    fn,
    start,
    end,
    ltfTimeframe: fn === 'signal' ? ltfTimeframe : undefined,
    csvPath: args.get('csv') ?? undefined,
  });
  console.log(`  ✓ ${fn} → ${record.file} (${record.caption.slice(0, 60)}…)`);
  return record;
});

// 3. The regime timeline (no analysis snapshot — it is its own composite).
const timeline = biasTimeline(windows, 'USTEC', { k: k != null ? Number(k) : 5 });
const timelineRecord = saveChart({
  caseId,
  rendered: renderPng(timeline),
  spec: timeline,
  caption: `${timeline.meta.title} — ${timeline.meta.subtitle}`,
  start,
  end,
});
console.log(`  ✓ bias-timeline → ${timelineRecord.file}`);

// 4. Report page: template + auto-filled figures + a facts digest, so the
//    case is presentable the moment `npm run report` finishes. The digest
//    paragraph deliberately carries NO data-i18n (i18n init would overwrite
//    it with the placeholder); the LLM narrative step polishes it further.
const dir = caseDirPath(caseId);
mkdirSync(join(dir, 'report'), { recursive: true });
setCaseSourceHash(caseId, sourceCsvSha256(args.get('csv')));

const figures = [...chartRecords, timelineRecord]
  .map(
    (r) => `      <figure>
        <img src="../charts/${r.id}.png" alt="${esc(r.altText)}" />
        <figcaption>
          ${esc(r.caption)}
          <div class="caption-note">artifact: ${esc(r.id)} · sha256 ${r.sha256.slice(0, 12)}… · fn=${esc(r.provenance.fn)}</div>
        </figcaption>
      </figure>`
  )
  .join('\n');

const signalRecord = chartRecords.find((r) => r.provenance.fn === 'signal');
const qualifiedSignals = countSignals(signalRecord);
const digest = `USTEC ${timeframe} ${start} → ${end} — regime ${regime.structure} (${regime.bias}) · ${windows.length} monthly window(s) (${windows.map((w) => w.label).join(', ')}) · ${chartRecords.length + 1} charts · ${qualifiedSignals} qualifying signal(s) at minRR ${minRR ?? 2}. ${htfAll.clippedFromEnd ? 'The requested end ran past the feed: the last month(s) are sparse clipped data, not a quiet market.' : ''} Edit this summary and add the narrative.`;

let reportHtml = readFileSync(TEMPLATE_PATH, 'utf8');
// Drop the LLM guidance comment, then swap placeholder paragraph → digest
// (no data-i18n, so i18n init won't clobber it).
reportHtml = reportHtml.split('      <!-- LLM: ')[0] + reportHtml.slice(reportHtml.indexOf('-->', reportHtml.indexOf('<!-- LLM:')) + 3);
reportHtml = reportHtml.replace(
  /<p id="report-summary"[^>]*>[\s\S]*?<\/p>/,
  `<p id="report-summary">${esc(digest)}</p>`
);
// Replace the figure-template comment block with the real figures.
const figStart = reportHtml.indexOf('<!-- Figure template');
if (figStart >= 0) {
  const figEnd = reportHtml.indexOf('-->', figStart) + 3;
  reportHtml = reportHtml.slice(0, figStart) + figures + '\n' + reportHtml.slice(figEnd);
}
writeFileSync(join(dir, 'report', 'index.html'), reportHtml);

const summary = {
  caseId,
  range: { start, end },
  timeframe,
  ltfTimeframe,
  regime: { structure: regime.structure, bias: regime.bias, pivotCount: regime.pivotCount },
  monthlyWindows: windows.map((w) => w.label),
  // The requested end ran past the data (e.g. data ends 2026-03-03):
  // monthly windows after that are sparse; quote this when interpreting
  // the bias timeline.
  rangeClippedToDataEnd: htfAll.clippedFromEnd,
  charts: chartRecords.map((r) => ({ id: r.id, fn: r.provenance.fn, caption: r.caption })),
  timeline: timelineRecord.caption,
  reportFile: 'report/index.html',
  // LLM assembly rule: quote sidecar captions verbatim when writing
  // figures; summary.json + case.json are the ground truth.
};
writeFileSync(join(dir, 'report', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const manifest = readCaseManifest(caseId);
console.log('\nDone — case contents:');
console.log(JSON.stringify(
  {
    caseId,
    charts: manifest.charts.length,
    bars: manifest.bars.map((b) => `${b.timeframe}(${b.rows})`),
    analysis: manifest.analysis.map((a) => a.fn),
    report: 'report/index.html + report/summary.json',
  },
  null,
  2
));
console.log(`\nReport: cases/${caseId}/report/index.html — figures auto-filled; polish the #report-summary narrative via the sidecars.`);