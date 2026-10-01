/**
 * Composite charts — one call per analysis view.
 *
 * Composites run the analysis functions themselves (over bars the caller
 * supplies, typically from `queryRange`) and assemble a complete
 * {@link ChartSpec}: candles + the view's overlays + a title block with
 * the bias/regime answer + provenance for the sidecar manifest. They are
 * the units the CLI (`npm run chart`) and HTTP (`/api/chart`) expose.
 *
 * Naming mirrors the analysis registry: `structureChart` ↔ `structure`,
 * `zonesChart` ↔ `zones-merged`, `liquidityChart` ↔ `liquidity`,
 * `signalChart` ↔ `signal`.
 */

import type { BosEvent, ChochEvent, LiquidityLevel, OhlcvBar, Pivot, Poi, Zone } from '../analysis/types';
import { classifyStructure, detectBos, detectChoch, findPivots } from '../analysis/structure';
import { findFvgs, findOrderBlocks, findSupplyDemand, liquidityLevels, mergeZones } from '../analysis/zones';
import { entrySignals, findPois } from '../analysis/signal';
import type { EntrySignalOptions, EntrySignalResult } from '../analysis/signal';
import {
  barsWindow,
  bosMarkers,
  chochMarkers,
  liquidityOverlays,
  pivotPolyline,
  signalOverlays,
  zoneOverlays,
} from './adapters';
import type { ChartSpec, Overlay } from './types';

export type CompositeOptions = {
  /** Pivot window (same `k` as the analysis registry). */
  k?: number;
  /** Chart title; defaults per composite. */
  title?: string;
  /** Chart width/height/theme passthrough. */
  layout?: ChartSpec['layout'];
};

function baseSpec(
  bars: OhlcvBar[],
  meta: Omit<ChartSpec['meta'], 'from' | 'to' | 'barCount'>,
  overlays: Overlay[],
  layout?: ChartSpec['layout']
): ChartSpec {
  const first = bars[0];
  const last = bars[bars.length - 1];
  return {
    meta: {
      ...meta,
      from: first?.time ?? 0,
      to: last?.time ?? 0,
      barCount: bars.length,
    },
    bars,
    overlays,
    layout,
  };
}

function identity(symbol: string, timeframe: string): { symbol: string; timeframe: string } {
  return { symbol, timeframe };
}

/**
 * Structure map: candles + zigzag + BOS/CHoCH markers (labels on the
 * latest event of each kind only — a chip per event collides into an
 * unreadable stack on dense ranges). The subtitle always carries the
 * structure verdict (HH_HL / LH_LL / RANGE) so the chart answers "what
 * is the market doing?" on sight.
 */
export type StructureChartResult = {
  spec: ChartSpec;
  analysis: {
    structure: string;
    pivots: Pivot[];
    bos: BosEvent[];
    choch: ChochEvent[];
  };
};

export function structureChart(
  bars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  opts: CompositeOptions = {}
): StructureChartResult {
  const k = opts.k ?? 5;
  const pivots = findPivots(bars, k);
  const structure = classifyStructure(pivots);
  const bos = detectBos(bars, pivots);
  const choch = detectChoch(bars, pivots);
  const overlays: Overlay[] = [
    pivotPolyline(pivots),
    ...bosMarkers(bos, { labels: 'last' }),
    ...chochMarkers(choch, { labels: 'last' }),
  ];
  const spec = baseSpec(bars, {
    ...identity(symbol, timeframe),
    title: opts.title ?? `${symbol} ${timeframe} — structure`,
    subtitle: `${structure} · ${pivots.length} pivots · k=${k}`,
    provenance: { fn: 'structure', params: { k } },
  }, overlays, opts.layout);
  return { spec, analysis: { structure, pivots, bos, choch } };
}

/**
 * Zone map: candles + all zone kinds merged into confluence POIs with
 * lifecycle styling. Fresh/touched zones stand out; broken ghosts stay
 * for context.
 */
export type ZonesChartResult = {
  spec: ChartSpec;
  analysis: { zones: Zone[] };
};

export function zonesChart(
  bars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  opts: CompositeOptions = {}
): ZonesChartResult {
  const k = opts.k ?? 5;
  const pivots = findPivots(bars, k);
  const zones = mergeZones([
    ...findFvgs(bars),
    ...findOrderBlocks(bars, pivots),
    ...findSupplyDemand(bars, pivots),
  ]);
  const fresh = zones.filter((z) => z.state === 'fresh' || z.state === 'touched').length;
  const spec = baseSpec(bars, {
    ...identity(symbol, timeframe),
    title: opts.title ?? `${symbol} ${timeframe} — zones`,
    subtitle: `${zones.length} zones · ${fresh} still tradeable (fresh/touched) · k=${k}`,
    provenance: { fn: 'zones-merged', params: { k } },
  }, zoneOverlays(zones), opts.layout);
  return { spec, analysis: { zones } };
}

export type LiquidityChartResult = {
  spec: ChartSpec;
  analysis: { levels: LiquidityLevel[] };
};

/**
 * Liquidity map: candles + old extremes + equal-high/low pools — the
 * draw-in levels that targets aim at.
 */
export function liquidityChart(
  bars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  opts: CompositeOptions = {}
): LiquidityChartResult {
  const k = opts.k ?? 5;
  const levels = liquidityLevels(bars, findPivots(bars, k), { tolerance: 0.001 });
  const spec = baseSpec(bars, {
    ...identity(symbol, timeframe),
    title: opts.title ?? `${symbol} ${timeframe} — liquidity`,
    subtitle: `${levels.filter((l) => l.kind.startsWith('equal')).length} equal pools · old high ${levels.find((l) => l.kind === 'old_high')?.price.toFixed(0) ?? '—'} · old low ${levels.find((l) => l.kind === 'old_low')?.price.toFixed(0) ?? '—'}`,
    provenance: { fn: 'liquidity', params: { k } },
  }, liquidityOverlays(levels), opts.layout);
  return { spec, analysis: { levels } };
}

/** Result of {@link signalChart}: the spec plus the analysis it encodes. */
export type SignalChartResult = {
  spec: ChartSpec;
  analysis: EntrySignalResult;
  pois: Poi[];
};

/**
 * The money chart: HTF bias, confluence POIs, and — per signal — the
 * full trade geometry (POI zone, trigger marker, entry/stop/target
 * bracket with shaded risk/reward and R:R).
 *
 * Context trimming: when signals exist the candles start ~40 bars before
 * the earliest POI touch so the setup is legible instead of a month of
 * noise.
 *
 * Returns the spec **and** the underlying analysis so the sidecar
 * manifest can quote exact fields without a second analysis pass.
 */
export function signalChart(
  htfBars: OhlcvBar[],
  ltfBars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  opts: EntrySignalOptions & { title?: string; layout?: ChartSpec['layout'] } = {}
): SignalChartResult {
  const analysis = entrySignals(htfBars, ltfBars, opts);
  const bias = analysis.bias;
  const pois = findPois(htfBars, bias.bias, { k: opts.htfK ?? 5 });

  // signalOverlays already renders each signal's POI zone — drop those
  // from the background set so signaled zones are not drawn twice.
  const poiKey = (p: { tCreated: number; top: number }) => `${p.tCreated}:${p.top}`;
  const signaled = new Set(analysis.signals.map((s) => poiKey(s.poi)));
  const overlays: Overlay[] = [...zoneOverlays(pois.filter((p) => !signaled.has(poiKey(p))))];
  for (const signal of analysis.signals) {
    overlays.push(...signalOverlays(signal));
  }

  const bars =
    analysis.signals.length > 0
      ? barsWindow(htfBars, Math.min(...analysis.signals.map((s) => s.poi.firstTouch ?? s.poi.tCreated)))
      : htfBars;

  const spec = baseSpec(bars, {
    ...identity(symbol, timeframe),
    title: opts.title ?? `${symbol} ${timeframe} — ${bias.bias === 'stand_aside' ? 'no setup (range)' : `${bias.bias.replace('_', ' ')} setup`}`,
    subtitle: `${bias.structure} · ${pois.length} POI(s) · ${analysis.signals.length} signal(s)${analysis.signals[0]?.rr != null ? ` · best R:R ${analysis.signals[0]!.rr!.toFixed(2)}` : ''}`,
    provenance: {
      fn: 'signal',
      params: {
        htfK: opts.htfK ?? 5,
        ltfK: opts.ltfK ?? 3,
        minRR: opts.minRR ?? 2,
        stopBuffer: opts.stopBuffer ?? 0.0005,
      },
    },
  }, overlays, opts.layout);

  return { spec, analysis, pois };
}
