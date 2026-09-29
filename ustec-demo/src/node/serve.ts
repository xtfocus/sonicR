/**
 * Local HTTP API over the USTEC datasets — the curl-able twin of
 * window.ustec. Serves the bar-range endpoint, the analysis-function
 * registry and the chart-rendering endpoints; keep `npm run dev` for
 * the UI.
 *
 *   npm run serve-api [-- --port 5200]
 *   curl 'http://localhost:5200/api/range?start=2025-09-01&end=2025-09-02&limit=10'
 *   curl '...&format=csv'
 *   curl 'http://localhost:5200/api/functions?lang=vi'
 *   curl 'http://localhost:5200/api/analyze?fn=pivots&start=2025-09-01&end=2025-10-01&timeframe=1H&k=8'
 *   curl 'http://localhost:5200/api/chart?fn=signal&start=2025-08-01&end=2025-09-01&timeframe=1H&ltfTimeframe=5m&minRR=1.5' -o chart.png
 *   curl 'http://localhost:5200/api/artifacts'
 *
 * /api/range params: start, end (required; same formats as window.ustec),
 * timeframe (label or seconds; default 5m), limit (positive integer),
 * format (json default | csv). Errors return 400 with { error }.
 *
 * /api/analyze params: fn (registry id), start, end (required),
 * timeframe, ltfTimeframe (trigger series for 'signal'), plus any
 * function parameter from /api/functions (bare booleans mean true).
 *
 * /api/chart params: fn (structure | zones-merged | liquidity | signal),
 * start, end (required), timeframe, ltfTimeframe, analysis params
 * (k, minRR, htfK, ltfK, stopBuffer), format (png default | svg | spec |
 * json → png + sidecar record when save=1), save (1 → also persist to
 * reports/<session>/), session, title, width, height, dpi, theme.
 *
 * /api/functions params: lang (en default | vi) for summary language.
 * /api/artifacts lists saved sessions; /api/artifacts/<session>/<file>
 * serves the stored PNG/JSON.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadApi } from './dataset';
import { buildCsvFilename } from '../data-export';
import type { UTCTimestamp } from 'lightweight-charts';

import { parseFlagArgs } from './parse-args';
import { describeAnalyzeFunctions, getAnalyzeFunction, runAnalyze } from '../analysis/registry';
import { buildChart } from './chart-core';
import { artifactPath, listArtifacts, saveChart } from './artifacts';
import { renderPng } from '../viz/png';
import { renderSvg } from '../viz/svg';
import { readFileSync } from 'node:fs';
import type { ChartSpec } from '../viz/types';

const api = loadApi();
const port = Number(parseFlagArgs(process.argv.slice(2)).get('port')) || Number(process.env.PORT) || 5200;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text + '\n');
}

function handleRange(url: URL, res: ServerResponse): void {
  const qs = url.searchParams;
  const start = qs.get('start');
  const end = qs.get('end');
  if (start == null || end == null || start === '' || end === '') {
    throw new Error("Missing required query params 'start' and 'end'.");
  }
  const timeframe = qs.get('timeframe');
  const limitRaw = qs.get('limit');
  let limit: number | undefined;
  if (limitRaw != null && limitRaw !== '') {
    if (!/^\d+$/.test(limitRaw)) {
      throw new Error(`Invalid limit: '${limitRaw}'. Use a positive integer.`);
    }
    limit = Number(limitRaw);
  }

  const result = api.queryRange(start, end, {
    timeframe: timeframe == null || timeframe === '' ? undefined : timeframe,
    limit,
  });

  const format = qs.get('format');
  if (format === 'csv') {
    const filename = buildCsvFilename('USTEC', result.timeframe, {
      start: result.requested.start as UTCTimestamp,
      end: result.requested.end as UTCTimestamp,
    });
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `inline; filename="${filename}"`,
    });
    res.end(api.toCsv(result));
    return;
  }
  if (format != null && format !== '' && format !== 'json') {
    throw new Error(`Invalid format: '${format}'. Use 'json' or 'csv'.`);
  }
  sendJson(res, 200, result);
}

/** Query params owned by /api/analyze itself; the rest go to the function. */
const ANALYZE_CONTROL_PARAMS = new Set([
  'fn',
  'start',
  'end',
  'timeframe',
  'ltfTimeframe',
]);

function handleAnalyze(url: URL, res: ServerResponse): void {
  const qs = url.searchParams;
  const fn = qs.get('fn');
  const start = qs.get('start');
  const end = qs.get('end');
  if (!fn || !start || !end) {
    throw new Error("Missing required query params 'fn', 'start' and 'end'.");
  }
  if (!getAnalyzeFunction(fn)) {
    throw new Error(`Unknown fn '${fn}'. See GET /api/functions for the catalogue.`);
  }

  const rawParams: Record<string, string> = {};
  for (const [key, value] of qs) {
    if (!ANALYZE_CONTROL_PARAMS.has(key)) rawParams[key] = value;
  }

  const htf = api.queryRange(start, end, { timeframe: qs.get('timeframe') ?? undefined });
  const ltfTimeframe = qs.get('ltfTimeframe');
  const ltf = ltfTimeframe != null ? api.queryRange(start, end, { timeframe: ltfTimeframe }) : undefined;

  sendJson(
    res,
    200,
    runAnalyze(
      fn,
      {
        bars: htf.bars,
        intervalSeconds: htf.intervalSeconds,
        ltfBars: ltf?.bars,
        ltfIntervalSeconds: ltf?.intervalSeconds,
      },
      rawParams
    )
  );
}

function numParam(qs: URLSearchParams, key: string): number | null {
  const raw = qs.get(key);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function handleChart(url: URL, res: ServerResponse): void {
  const qs = url.searchParams;
  const start = qs.get('start');
  const end = qs.get('end');
  if (!start || !end) throw new Error("Missing required query params 'start' and 'end'.");

  const theme = qs.get('theme');
  const layout: ChartSpec['layout'] = {
    ...(numParam(qs, 'width') != null ? { width: numParam(qs, 'width')! } : {}),
    ...(numParam(qs, 'height') != null ? { height: numParam(qs, 'height')! } : {}),
    ...(numParam(qs, 'dpi') != null ? { dpi: numParam(qs, 'dpi')! } : {}),
    ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
  };

  const params: Record<string, string> = {};
  for (const key of ['k', 'minRR', 'htfK', 'ltfK', 'stopBuffer']) {
    const value = qs.get(key);
    if (value != null && value !== '') params[key] = value;
  }

  const outcome = buildChart(api, {
    fn: qs.get('fn') ?? '',
    start,
    end,
    timeframe: qs.get('timeframe') ?? undefined,
    ltfTimeframe: qs.get('ltfTimeframe') ?? undefined,
    params,
    title: qs.get('title') ?? undefined,
    layout,
  });

  const format = qs.get('format') ?? 'png';
  if (format === 'spec') {
    sendJson(res, 200, outcome.spec);
    return;
  }
  if (format === 'svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
    res.end(renderSvg(outcome.spec));
    return;
  }
  if (format !== 'png' && format !== 'json') {
    throw new Error(`Invalid format: '${format}'. Use png, svg, spec or json.`);
  }

  const rendered = renderPng(outcome.spec);
  if (format === 'json' || qs.get('save') === '1') {
    const record = saveChart({
      session: qs.get('session') ?? 'default',
      rendered,
      spec: outcome.spec,
      caption: outcome.caption,
      start,
      end,
      ltfTimeframe: qs.get('ltfTimeframe') ?? undefined,
      analysisDigest: outcome.signal
        ? { bias: outcome.signal.bias, pois: outcome.signal.pois.length, signals: outcome.signal.signals }
        : undefined,
    });
    if (format === 'json') {
      sendJson(res, 200, { record, pngBytes: rendered.png.length });
      return;
    }
    res.writeHead(200, {
      'content-type': 'image/png',
      'x-artifact-id': record.id,
      'x-artifact-session': record.session,
      'x-artifact-sha256': record.sha256,
    });
    res.end(rendered.png);
    return;
  }
  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(rendered.png);
}

function handleArtifactFile(url: URL, res: ServerResponse): void {
  const parts = url.pathname.split('/').filter(Boolean); // api, artifacts, session…, file
  const file = parts[parts.length - 1] ?? '';
  const session = parts.slice(2, -1).join('/');
  const path = artifactPath(session, file);
  if (path == null) {
    sendJson(res, 404, { error: `No artifact '${file}' in session '${session}'.` });
    return;
  }
  if (file.endsWith('.json')) {
    sendJson(res, 200, JSON.parse(readFileSync(path, 'utf8')));
    return;
  }
  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(readFileSync(path));
}

createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/range') {
    try {
      handleRange(url, res);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/functions') {
    const lang = url.searchParams.get('lang') === 'vi' ? 'vi' : 'en';
    sendJson(res, 200, { functions: describeAnalyzeFunctions(lang) });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/analyze') {
    try {
      handleAnalyze(url, res);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/chart') {
    try {
      handleChart(url, res);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/artifacts') {
    sendJson(res, 200, { sessions: listArtifacts() });
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
    handleArtifactFile(url, res);
    return;
  }
  sendJson(res, 404, {
    error: 'not found',
    hint: 'GET /api/range | /api/functions | /api/analyze?fn=… | /api/chart?fn=…&start=…&end=… | /api/artifacts',
  });
}).listen(port, () => {
  console.log(
    `USTEC API on http://localhost:${port} — /api/range, /api/functions, /api/analyze, /api/chart, /api/artifacts — Ctrl+C to stop`
  );
});
