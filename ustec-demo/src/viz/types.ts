/**
 * ChartSpec — the pure JSON contract between analysis outputs and pixels.
 *
 * A spec is bars + a list of overlay primitives + layout hints. Analysis
 * adapters (`src/viz/adapters.ts`) produce overlays from library outputs;
 * the renderer (`src/viz/svg.ts` + `src/viz/png.ts`) turns the spec into
 * SVG/PNG. Specs are plain JSON: they can be logged, diffed, stored and
 * re-rendered — a PNG is always reproducible from its spec (the sidecar
 * manifest stores the query that produced it).
 *
 * ## Positioning rules
 *
 * - Overlays anchor by **bar time**; the renderer resolves each time to
 *   the nearest bar index (inclusive bounds, clamped to the plot). The
 *   x-axis is bar-index based, so sessions gaps never stretch the chart —
 *   matching how the analysis layer itself reasons (bar indices).
 * - Vertical extents come from the bars **and** the overlays: zones,
 *   levels and brackets outside the bar range still render (the price
 *   scale expands to include them).
 */

import type { OhlcvBar } from '../analysis/types';

export type { OhlcvBar };

/** Direction of a directional overlay (zones, brackets, markers). */
export type VizDir = 'bull' | 'bear';

/** Lifecycle of a zone overlay — drives styling via the theme. */
export type VizZoneState = 'fresh' | 'touched' | 'mitigated' | 'broken';

/** Horizontal price line with an optional label. */
export type LevelOverlay = {
  type: 'level';
  price: number;
  label?: string;
  color?: string;
  dashed?: boolean;
};

/** Price×time rectangle (zone / POI). Extends to the right edge when `toTime` is omitted. */
export type ZoneOverlay = {
  type: 'zone';
  top: number;
  bottom: number;
  /** Bar time the zone starts at. */
  fromTime: number;
  /** Bar time the zone ends at; omit to extend to the right edge. */
  toTime?: number;
  dir: VizDir;
  label?: string;
  state?: VizZoneState;
};

/** Line through (time, price) points — zigzags, trendlines. */
export type PolylineOverlay = {
  type: 'polyline';
  points: Array<{ time: number; price: number }>;
  color?: string;
  dashed?: boolean;
  label?: string;
};

/** Shape anchored to a bar (and optionally an explicit price). */
export type MarkerOverlay = {
  type: 'marker';
  time: number;
  /** Defaults to the bar's high (up shapes) / low (down shapes). */
  price?: number;
  shape: 'triangle-up' | 'triangle-down' | 'dot' | 'cross' | 'arrow-up' | 'arrow-down';
  color?: string;
  label?: string;
};

/** Vertical event line at a bar. */
export type VlineOverlay = {
  type: 'vline';
  time: number;
  label?: string;
  color?: string;
  dashed?: boolean;
};

/**
 * Trade geometry: entry/stop/target levels over a time span, with shaded
 * risk (entry→stop) and reward (entry→target) boxes and an R:R note.
 */
export type BracketOverlay = {
  type: 'bracket';
  dir: VizDir;
  entry: number;
  stop: number;
  target: number;
  /** Bar time the setup starts (left edge of the shaded boxes). */
  startTime: number;
  /** Bar time the setup ends; omit for the right edge. */
  endTime?: number;
  rr?: number;
  label?: string;
};

/** Freeform text anchored at (time, price). */
export type TextOverlay = {
  type: 'text';
  time: number;
  price: number;
  text: string;
  anchor?: 'left' | 'right';
  color?: string;
};

/** Full-height background band (sessions, regimes). */
export type BandOverlay = {
  type: 'band';
  fromTime: number;
  toTime?: number;
  color?: string;
  label?: string;
};

export type Overlay =
  | LevelOverlay
  | ZoneOverlay
  | PolylineOverlay
  | MarkerOverlay
  | VlineOverlay
  | BracketOverlay
  | TextOverlay
  | BandOverlay;

/** Document-level metadata rendered as a title block + footer. */
export type ChartMeta = {
  title?: string;
  subtitle?: string;
  symbol: string;
  timeframe: string;
  /** Evaluated bar range, UTC seconds (from the result envelope). */
  from: number;
  to: number;
  barCount: number;
  /**
   * How this chart was produced — echoed verbatim into the sidecar
   * manifest so a PNG is always traceable to its query. Timestamps are
   * kept OUT of the rendered pixels to keep rendering deterministic.
   */
  provenance?: {
    fn?: string;
    params?: Record<string, number | boolean | string>;
    start?: string;
    end?: string;
    ltfTimeframe?: string;
  };
};

export type ThemeName = 'dark' | 'light';

export type ChartLayout = {
  /** Pixel width of the output (before dpi scaling); default 1600. */
  width?: number;
  /** Pixel height of the output (before dpi scaling); default 900. */
  height?: number;
  /** Rasterization multiplier; default 2 (crisp on hi-dpi). */
  dpi?: number;
  theme?: ThemeName;
  /** Hide the auto-generated legend. */
  hideLegend?: boolean;
  /** Price decimals for axis/label formatting; default inferred. */
  decimals?: number;
};

export type ChartSpec = {
  meta: ChartMeta;
  /** Ascending bars; the x-axis is their index. */
  bars: OhlcvBar[];
  overlays: Overlay[];
  layout?: ChartLayout;
};
