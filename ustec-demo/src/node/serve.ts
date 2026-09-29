/**
 * Local HTTP API over the USTEC datasets — the curl-able twin of
 * window.ustec. Serves only the query endpoint; keep `npm run dev` for the UI.
 *
 *   npm run serve-api [-- --port 5200]
 *   curl 'http://localhost:5200/api/range?start=2025-09-01&end=2025-09-02&limit=10'
 *   curl '...&format=csv'
 *
 * Query params: start, end (required; same formats as window.ustec),
 * timeframe (label or seconds; default 5m), limit (positive integer),
 * format (json default | csv). Errors return 400 with { error }.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadApi } from './dataset';
import { buildCsvFilename } from '../data-export';
import type { UTCTimestamp } from 'lightweight-charts';

import { parseFlagArgs } from './parse-args';

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
  sendJson(res, 404, {
    error: 'not found',
    hint: "GET /api/range?start=…&end=…[&timeframe=…][&limit=…][&format=json|csv]",
  });
}).listen(port, () => {
  console.log(`USTEC range API on http://localhost:${port}/api/range — Ctrl+C to stop`);
});
