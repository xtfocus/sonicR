/**
 * Chart themes — every color decision lives here.
 *
 * The dark palette mirrors the live app (`index.html` /
 * lightweight-charts defaults) so server-rendered charts and the browser
 * chart read as one product. Zone styling is derived from `dir` +
 * `state` in a single place (`zoneStyle`), so lifecycle semantics stay
 * visually consistent across every chart type.
 */

import type { ThemeName, VizDir, VizZoneState } from './types';

export type Theme = {
  background: string;
  grid: string;
  text: string;
  mutedText: string;
  titleText: string;
  axisText: string;
  bullBody: string;
  bearBody: string;
  bullWick: string;
  bearWick: string;
  accent: string;
  levelDefault: string;
  bandFill: string;
  riskFill: string;
  rewardFill: string;
  fontFamily: string;
};

const dark: Theme = {
  background: '#131722',
  grid: '#1f2943',
  text: '#d1d4dc',
  mutedText: '#8a92a6',
  titleText: '#d1d4dc',
  axisText: '#8a92a6',
  bullBody: '#26a69a',
  bearBody: '#ef5350',
  bullWick: '#26a69a',
  bearWick: '#ef5350',
  accent: '#4c6ef5',
  levelDefault: '#b0b6c3',
  bandFill: '#1a2233',
  riskFill: 'rgba(239,83,80,0.18)',
  rewardFill: 'rgba(38,166,154,0.18)',
  fontFamily: 'DejaVu Sans',
};

const light: Theme = {
  background: '#ffffff',
  grid: '#e6e9ef',
  text: '#1b1e26',
  mutedText: '#5b6272',
  titleText: '#1b1e26',
  axisText: '#5b6272',
  bullBody: '#089981',
  bearBody: '#f23645',
  bullWick: '#089981',
  bearWick: '#f23645',
  accent: '#3b5bdb',
  levelDefault: '#6a7180',
  bandFill: '#f1f3f7',
  riskFill: 'rgba(242,54,69,0.15)',
  rewardFill: 'rgba(8,153,129,0.15)',
  fontFamily: 'DejaVu Sans',
};

const themes: Record<ThemeName, Theme> = { dark, light };

export function getTheme(name: ThemeName = 'dark'): Theme {
  return themes[name] ?? dark;
}

export type ZoneStyle = {
  /** Fill color with alpha (SVG rgba). */
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** 0–1; broken zones fade almost out. */
  opacity: number;
  dashed: boolean;
  labelColor: string;
};

const ZONE_BASE: Record<VizDir, { hue: string }> = {
  bull: { hue: '#26a69a' },
  bear: { hue: '#ef5350' },
};

/**
 * Visual grammar for zone lifecycles:
 *
 * - `fresh`    — solid fill, full presence
 * - `touched`  — same hue, slightly lighter fill
 * - `mitigated`— dashed border, reduced fill (imbalance filled)
 * - `broken`   — dotted outline only (kept for context; a filled ghost
 *                stack of hundreds of dead zones drowns the chart)
 */
export function zoneStyle(dir: VizDir, state: VizZoneState = 'fresh'): ZoneStyle {
  const hue = ZONE_BASE[dir].hue;
  const fillAlpha: Record<VizZoneState, number> = {
    fresh: 0.22,
    touched: 0.14,
    mitigated: 0.08,
    broken: 0,
  };
  const strokeAlpha: Record<VizZoneState, number> = {
    fresh: 0.9,
    touched: 0.75,
    mitigated: 0.6,
    broken: 0.22,
  };
  const dash: Record<VizZoneState, string | undefined> = {
    fresh: undefined,
    touched: undefined,
    mitigated: '6 4',
    broken: '2 4',
  };
  return {
    fill: hexWithAlpha(hue, fillAlpha[state]),
    stroke: hexWithAlpha(hue, strokeAlpha[state]),
    strokeWidth: 1.5,
    opacity: 1,
    dashed: dash[state] != null,
    labelColor: hue,
  };
}

/** Blend: `#rrggbb` + alpha (0–1) → CSS `rgba(...)`. */
function hexWithAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
