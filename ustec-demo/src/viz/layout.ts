/**
 * Plot layout math — the only module that maps prices and bar indices to
 * pixels. Pure and unit-testable; the SVG emitter consumes a
 * {@link PlotLayout} and never computes geometry itself.
 *
 * Responsibilities:
 *
 * - Price scale: linear, covering the bars **and** overlay extents
 *   (zones/levels/brackets outside the bar range must still render),
 *   padded 4% top and bottom.
 * - X scale: bar **index** (session gaps never stretch the chart),
 *   each bar centered in an equal-width slot.
 * - Time → index resolution for overlay anchors (binary search,
 *   inclusive bounds, clamped to the plot).
 * - Axis ticks: ~6 "nice" price steps; 4–8 time ticks with labels whose
 *   format adapts to the span (intraday vs multi-day).
 */

import type { ChartSpec, Overlay } from './types';

export type PlotArea = { x: number; y: number; width: number; height: number };

export type PriceTick = { price: number; y: number; label: string };

export type TimeTick = { index: number; x: number; label: string };

export type PlotLayout = {
  width: number;
  height: number;
  area: PlotArea;
  priceMin: number;
  priceMax: number;
  priceDecimals: number;
  /** Bar index → center-x pixel. */
  xForIndex: (index: number) => number;
  /** Price → y pixel. */
  yForPrice: (price: number) => number;
  /** Bar time → nearest bar index (clamped). */
  indexOfTime: (time: number) => number;
  barSlotWidth: number;
  priceTicks: PriceTick[];
  timeTicks: TimeTick[];
};

const LEFT_AXIS = 86;
const RIGHT_PAD = 16;
const TOP_PAD = 16;
/** Time labels (28) + legend row (20) + footer line (24). */
const BOTTOM_AXIS = 72;

/** Infer a sensible decimals count from the bar prices. */
function inferDecimals(bars: Array<{ close: number }>): number {
  const sample = bars[0]?.close ?? 0;
  if (sample === 0) return 2;
  const abs = Math.abs(sample);
  if (abs >= 10000) return 1;
  if (abs >= 100) return 2;
  return 4;
}

/** Overlay extents that must stay visible (expands the price scale). */
function overlayExtents(overlays: Overlay[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const o of overlays) {
    switch (o.type) {
      case 'level':
        min = Math.min(min, o.price);
        max = Math.max(max, o.price);
        break;
      case 'zone':
        min = Math.min(min, o.bottom);
        max = Math.max(max, o.top);
        break;
      case 'bracket':
        min = Math.min(min, o.stop, o.target, o.entry);
        max = Math.max(max, o.stop, o.target, o.entry);
        break;
      case 'polyline':
        for (const p of o.points) {
          min = Math.min(min, p.price);
          max = Math.max(max, p.price);
        }
        break;
      case 'marker':
      case 'text':
        if (o.price != null) {
          min = Math.min(min, o.price);
          max = Math.max(max, o.price);
        }
        break;
      default:
        break;
    }
  }
  return min === Infinity ? null : { min, max };
}

/** First bar index with `time >= target`, clamped to [0, n-1]. */
export function indexOfTime(bars: Array<{ time: number }>, target: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time < target) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(bars.length - 1, lo));
}

function niceStep(range: number, targetCount: number): number {
  const rough = range / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

/** Time-tick labels: intraday shows HH:MM, multi-day shows MMM D. */
function formatTimeLabel(seconds: number, spanSeconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (spanSeconds <= 36 * 3600) {
    return `${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function computeLayout(spec: ChartSpec, defaults: { width: number; height: number }): PlotLayout {
  const width = spec.layout?.width ?? defaults.width;
  const height = spec.layout?.height ?? defaults.height;
  const bars = spec.bars;
  const decimals = spec.layout?.decimals ?? inferDecimals(bars);

  // Reserve vertical space for the title block so it never overlaps the
  // plot (title 30px + subtitle 24px, plus breathing room).
  const titleSpace =
    (spec.meta.title != null ? 30 : 0) + (spec.meta.subtitle != null ? 26 : 0);

  const area: PlotArea = {
    x: LEFT_AXIS,
    y: TOP_PAD + titleSpace,
    width: Math.max(50, width - LEFT_AXIS - RIGHT_PAD),
    height: Math.max(50, height - TOP_PAD - titleSpace - BOTTOM_AXIS),
  };

  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (const b of bars) {
    priceMin = Math.min(priceMin, b.low);
    priceMax = Math.max(priceMax, b.high);
  }
  const extents = overlayExtents(spec.overlays);
  if (extents) {
    priceMin = Math.min(priceMin, extents.min);
    priceMax = Math.max(priceMax, extents.max);
  }
  if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMin === priceMax) {
    priceMin = Number.isFinite(priceMin) ? priceMin : 0;
    priceMax = priceMin === 0 ? 1 : priceMin;
  }
  const pad = (priceMax - priceMin) * 0.04;
  priceMin -= pad;
  priceMax += pad;

  const n = Math.max(1, bars.length);
  const barSlotWidth = area.width / n;

  const xForIndex = (index: number) => area.x + (index + 0.5) * barSlotWidth;
  const yForPrice = (price: number) =>
    area.y + ((priceMax - price) / (priceMax - priceMin)) * area.height;

  const priceTicks: PriceTick[] = [];
  const step = niceStep(priceMax - priceMin, 6);
  const start = Math.ceil(priceMin / step) * step;
  for (let p = start; p <= priceMax; p += step) {
    priceTicks.push({ price: p, y: yForPrice(p), label: p.toFixed(decimals) });
  }

  const timeTicks: TimeTick[] = [];
  // An empty-bars spec (pure annotation scenes from agents) has no time
  // axis labels — everything else still renders.
  if (bars.length > 0) {
    const spanSeconds = bars.length > 1 ? bars[bars.length - 1]!.time - bars[0]!.time : 0;
    const tickCount = Math.min(7, Math.max(2, Math.floor(area.width / 180)));
    const tickEvery = Math.max(1, Math.floor(n / tickCount));
    for (let i = 0; i < n; i += tickEvery) {
      timeTicks.push({
        index: i,
        x: xForIndex(i),
        label: formatTimeLabel(bars[i]!.time, spanSeconds),
      });
    }
  }

  return {
    width,
    height,
    area,
    priceMin,
    priceMax,
    priceDecimals: decimals,
    xForIndex,
    yForPrice,
    indexOfTime: (time: number) => indexOfTime(bars, time),
    barSlotWidth,
    priceTicks,
    timeTicks,
  };
}
