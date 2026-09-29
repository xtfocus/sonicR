/**
 * SVG → PNG rasterization via `@resvg/resvg-js`.
 *
 * Determinism is the whole point: system fonts are **not** loaded — only
 * the bundled DejaVu files under `assets/fonts/` — so the same spec
 * rasterizes to identical bytes on any machine. The multiplier (`dpi`)
 * controls crispness; the SVG itself is always laid out at logical
 * pixel size and scaled here.
 */

import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { ChartSpec } from './types';
import { renderSvg } from './svg';

const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));

/** Font files loaded for rasterization (regular + bold, DejaVu Sans, OFL). */
const FONT_FILES = [`${fontDir}DejaVuSans.ttf`, `${fontDir}DejaVuSans-Bold.ttf`];

export type RenderedPng = {
  png: Buffer;
  width: number;
  height: number;
  /** Filled by the artifacts layer; kept here so callers can chain. */
  svg: string;
};

/**
 * Render a spec to PNG bytes.
 *
 * @param spec       The chart spec.
 * @param layoutSize Default canvas size when `spec.layout` omits it
 *                   (CLI and HTTP agree on 1600×900).
 */
export function renderPng(
  spec: ChartSpec,
  layoutSize: { width: number; height: number } = { width: 1600, height: 900 }
): RenderedPng {
  const svg = renderSvg(spec, layoutSize);
  const dpi = spec.layout?.dpi ?? 2;
  const width = spec.layout?.width ?? layoutSize.width;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(width * dpi) },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'DejaVu Sans',
      serifFamily: 'DejaVu Sans',
      sansSerifFamily: 'DejaVu Sans',
      monospaceFamily: 'DejaVu Sans',
    },
  });
  const rendered = resvg.render();
  return {
    png: Buffer.from(rendered.asPng()),
    width: rendered.width,
    height: rendered.height,
    svg,
  };
}

/** Load a font file's bytes (exposed for tests/tools that need it). */
export function bundledFontBytes(name: 'DejaVuSans.ttf' | 'DejaVuSans-Bold.ttf'): Buffer {
  return readFileSync(`${fontDir}${name}`);
}
