/**
 * Shared chart-request core — the single path both the CLI
 * (`npm run chart`) and the HTTP endpoint (`GET /api/chart`) call.
 *
 * Mirrors `runAnalyze` from the analysis registry: validate the fn id,
 * load bars for the requested timeframes, run the matching composite,
 * and build a caption that states the analysis verdict in one sentence.
 * Transport layers only move arguments; this module owns semantics.
 */

import type { RangeQueryApi } from '../range-query-api';
import type { ChartSpec } from '../viz/types';
import {
  liquidityChart,
  signalChart,
  structureChart,
  zonesChart,
  type SignalChartResult,
} from '../viz/composites';

/** Chart-able functions (a subset of the analysis registry). */
export const CHART_FNS = ['structure', 'zones-merged', 'liquidity', 'signal'] as const;

export type ChartFnId = (typeof CHART_FNS)[number];

export type ChartRequest = {
  fn: string;
  start: string;
  end: string;
  timeframe?: string;
  ltfTimeframe?: string;
  /** Analysis parameters: k for the trio, htfK/ltfK/minRR/stopBuffer for signal. */
  params: Record<string, string>;
  title?: string;
  layout?: ChartSpec['layout'];
};

export type ChartOutcome = {
  spec: ChartSpec;
  /** Present for `signal` — quoted verbatim into the sidecar digest. */
  signal?: SignalChartResult['analysis'];
  caption: string;
};

function parseNumber(params: Record<string, string>, key: string): number | undefined {
  const raw = params[key];
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${key}='${raw}': expected a number.`);
  return n;
}

/**
 * Run one chart request against the dataset.
 *
 * Throws on unknown fn or bad params (same error style as the analysis
 * registry); callers map that to exit code 1 / HTTP 400.
 */
export function buildChart(api: RangeQueryApi, req: ChartRequest): ChartOutcome {
  const fn = req.fn as ChartFnId;
  if (!CHART_FNS.includes(fn)) {
    throw new Error(`Unknown chart fn '${req.fn}'. Chart-able: ${CHART_FNS.join(', ')}.`);
  }
  const allowed = new Set(['k', 'minRR', 'htfK', 'ltfK', 'stopBuffer', 'limit', 'includeMitigated']);
  for (const key of Object.keys(req.params)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown parameter '${key}' for chart '${fn}'. Accepted: ${[...allowed].join(', ')}.`);
    }
  }

  const symbol = 'USTEC';
  const htf = api.queryRange(req.start, req.end, { timeframe: req.timeframe });
  const tfLabel = htf.timeframe;
  const k = parseNumber(req.params, 'k');

  if (fn === 'signal') {
    const ltf = api.queryRange(req.start, req.end, {
      timeframe: req.ltfTimeframe ?? req.timeframe ?? '5m',
    });
    const result = signalChart(htf.bars, ltf.bars, symbol, tfLabel, {
      htfK: parseNumber(req.params, 'htfK') ?? k,
      ltfK: parseNumber(req.params, 'ltfK'),
      minRR: parseNumber(req.params, 'minRR'),
      stopBuffer: parseNumber(req.params, 'stopBuffer'),
      title: req.title,
      layout: req.layout,
    });
    return { spec: result.spec, signal: result.analysis, caption: signalCaption(symbol, tfLabel, result) };
  }

  const spec =
    fn === 'structure'
      ? structureChart(htf.bars, symbol, tfLabel, { k, title: req.title, layout: req.layout })
      : fn === 'zones-merged'
        ? zonesChart(htf.bars, symbol, tfLabel, { k, title: req.title, layout: req.layout })
        : liquidityChart(htf.bars, symbol, tfLabel, { k, title: req.title, layout: req.layout });
  return { spec, caption: `${spec.meta.title} — ${spec.meta.subtitle}` };
}

/** One-sentence verdict for the money chart, quoting exact signal fields. */
function signalCaption(symbol: string, timeframe: string, result: SignalChartResult): string {
  const { bias, signals } = result.analysis;
  if (bias.bias === 'stand_aside' || signals.length === 0) {
    return `${symbol} ${timeframe}: ${bias.structure} — regime gate closed (${bias.bias}), no signals.`;
  }
  const s = signals[0]!;
  const range = `${isoDate(result.spec.meta.from)} → ${isoDate(result.spec.meta.to)}`;
  return `${symbol} ${timeframe} ${range}: ${bias.structure} ${bias.bias.replace('_', ' ')}; ${s.poi.provenance.join('+')} POI ${s.poi.bottom.toFixed(0)}–${s.poi.top.toFixed(0)}; entry ${s.entry.toFixed(0)}, stop ${s.stop.toFixed(0)}, R:R ${s.rr?.toFixed(2) ?? '—'}, ${s.targets.length} target(s).`;
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}
