/**
 * Coverage composites — the supporting-cast charts beyond the core four
 * (`structureChart`, `zonesChart`, `liquidityChart`, `signalChart`).
 *
 * - {@link poisChart}        — bias-filtered, still-tradeable POIs only
 * - {@link equilibriumChart} — zigzag legs + 50% Sonic R midpoints
 * - {@link biasTimeline}     — regime bands over rolling windows
 * - {@link mtfStack}         — top-down multi-timeframe agreement rows
 *
 * Each returns a complete {@link ChartSpec}; the same overlay vocabulary
 * as the core composites applies.
 */

import { findPivots, labelLegs } from '../analysis/structure';
import { findPois, marketBias } from '../analysis/signal';
import type { Bias, OhlcvBar } from '../analysis/types';
import { legLabels, pivotPolyline, zoneOverlays } from './adapters';
import type { ChartSpec, LevelOverlay, Overlay, TextOverlay } from './types';

export type CoverageOptions = { k?: number; title?: string; layout?: ChartSpec['layout'] };

/** Bias-filtered POI chart — the tradeable subset of the zone map. */
export function poisChart(
  bars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  bias: Bias,
  opts: CoverageOptions & { includeMitigated?: boolean; limit?: number } = {}
): ChartSpec {
  const k = opts.k ?? 5;
  const pois = findPois(bars, bias, { k, includeMitigated: opts.includeMitigated, limit: opts.limit });
  const nearest = pois[0];
  return {
    meta: {
      title: opts.title ?? `${symbol} ${timeframe} — POIs (${bias})`,
      subtitle: `${pois.length} tradeable POI(s)${nearest != null ? ` · nearest ${nearest.provenance.join('+')} ${nearest.bottom.toFixed(0)}–${nearest.top.toFixed(0)}` : ''}`,
      symbol,
      timeframe,
      from: bars[0]?.time ?? 0,
      to: bars[bars.length - 1]?.time ?? 0,
      barCount: bars.length,
      provenance: { fn: 'pois', params: { k, bias } },
    },
    bars,
    overlays: zoneOverlays(pois),
    layout: opts.layout,
  };
}

/** Zigzag + 50% equilibrium levels of the most recent legs. */
export function equilibriumChart(
  bars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  opts: CoverageOptions & { count?: number } = {}
): ChartSpec {
  const k = opts.k ?? 5;
  const count = opts.count ?? 3;
  const pivots = findPivots(bars, k);
  const legs = labelLegs(pivots).slice(-count);
  const overlays: Overlay[] = [
    pivotPolyline(pivots),
    ...legLabels(pivots),
    ...legs.map<LevelOverlay>((leg) => ({
      type: 'level',
      price: leg.equilibrium,
      label: `EQ ${leg.label} ${leg.equilibrium.toFixed(0)}`,
      dashed: true,
    })),
    ...pivots.slice(-count - 1).map<TextOverlay>((p) => ({
      type: 'text',
      time: p.time,
      price: p.price,
      text: p.price.toFixed(0),
      anchor: p.kind === 'high' ? ('left' as const) : ('right' as const),
    })),
  ];
  return {
    meta: {
      title: opts.title ?? `${symbol} ${timeframe} — equilibrium`,
      subtitle: `${legs.length} recent leg(s) · 50% levels · k=${k}`,
      symbol,
      timeframe,
      from: bars[0]?.time ?? 0,
      to: bars[bars.length - 1]?.time ?? 0,
      barCount: bars.length,
      provenance: { fn: 'equilibrium', params: { k, count } },
    },
    bars,
    overlays,
    layout: opts.layout,
  };
}

/**
 * Regime strip: `bias` computed over consecutive windows, rendered as
 * full-height bands **over the real candles** — teal (long_only), red
 * (short_only), gray (stand_aside). Answers "when was this market
 * tradeable?" at a glance. Windows are (label, bars) slices of one
 * continuous series (e.g. months).
 *
 * Returns the per-window verdicts alongside the spec: the bands encode
 * them only as color + pixel labels, and a narrative writer that trusts
 * JSON over pixels would otherwise have nothing to quote — the exact gap
 * that reads as "all windows gray" in generated reports.
 */
export type BiasTimelineResult = {
  spec: ChartSpec;
  windows: Array<{ label: string; structure: string; bias: string; pivotCount: number }>;
};

export function biasTimeline(
  windows: Array<{ label: string; bars: OhlcvBar[] }>,
  symbol: string,
  opts: { title?: string; layout?: ChartSpec['layout']; k?: number } = {}
): BiasTimelineResult {
  const k = opts.k ?? 5;
  const bands: Overlay[] = [];
  const bars: OhlcvBar[] = [];
  const verdicts: BiasTimelineResult['windows'] = [];
  windows.forEach((win, i) => {
    if (win.bars.length === 0) return;
    const fromTime = win.bars[0]!.time;
    const next = windows[i + 1]?.bars[0];
    const toTime = next != null ? next.time : undefined; // omit → right edge
    const bias = marketBias(win.bars, k);
    verdicts.push({
      label: win.label,
      structure: bias.structure,
      bias: bias.bias,
      pivotCount: bias.pivotCount,
    });
    const color =
      bias.bias === 'long_only'
        ? 'rgba(38,166,154,0.16)'
        : bias.bias === 'short_only'
          ? 'rgba(239,83,80,0.16)'
          : 'rgba(138,146,166,0.14)';
    bands.push({ type: 'band', fromTime, toTime, color, label: win.label });
    bands.push({
      type: 'text',
      time: fromTime,
      price: Math.max(...win.bars.map((b) => b.high)),
      text: `${win.label}: ${bias.structure}`,
    });
    bars.push(...win.bars);
  });
  const spec: ChartSpec = {
    meta: {
      title: opts.title ?? `${symbol} — bias timeline (rolling windows)`,
      subtitle: `${windows.length} windows (${verdicts.map((v) => `${v.label} ${v.structure}`).join(', ')}) · k=${k} · teal long · red short · gray range`,
      symbol,
      timeframe: 'windows',
      from: bars[0]?.time ?? 0,
      to: bars[bars.length - 1]?.time ?? 0,
      barCount: bars.length,
      provenance: { fn: 'bias-timeline', params: { k } },
    },
    bars,
    overlays: bands,
    layout: { hideLegend: true, ...opts.layout },
  };
  return { spec, windows: verdicts };
}

/**
 * Top-down context stack: the same window rendered at several
 * timeframes, one mini-chart per row, bias verdict in each subtitle.
 * Agreement across rows is the multi-timeframe confirmation the
 * methodology demands before any entry. Returns one spec per timeframe.
 */
export function mtfStack(
  seriesByTf: Array<{ timeframe: string; bars: OhlcvBar[] }>,
  symbol: string,
  opts: { k?: number; layout?: ChartSpec['layout'] } = {}
): ChartSpec[] {
  const k = opts.k ?? 5;
  return seriesByTf.map(({ timeframe, bars }) => {
    const pivots = findPivots(bars, k);
    const bias = marketBias(bars, k);
    return {
      meta: {
        title: `${symbol} ${timeframe}`,
        subtitle: `${bias.structure} → ${bias.bias}`,
        symbol,
        timeframe,
        from: bars[0]?.time ?? 0,
        to: bars[bars.length - 1]?.time ?? 0,
        barCount: bars.length,
        provenance: { fn: 'mtf-stack', params: { k, timeframe } },
      },
      bars,
      overlays: [pivotPolyline(pivots), ...legLabels(pivots)],
      layout: { width: 1200, height: 420, hideLegend: true, ...opts.layout },
    };
  });
}
