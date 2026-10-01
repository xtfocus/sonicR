/**
 * ChartSpec → SVG. Pure string building — no DOM, no measuring.
 *
 * Rendering order (bottom → top):
 *   background → bands → grid → zones → candles → polylines → brackets
 *   → levels → vlines → markers → texts → axes → title block → legend
 *
 * Text width is *estimated* (0.62 × fontSize per char — DejaVu Sans
 * average advance) because there is no layout engine; labels are padded
 * conservatively and clipped to the plot. No timestamps are drawn inside
 * the canvas (provenance lives in the sidecar), so output is
 * deterministic for a given spec.
 */

import { computeLayout } from './layout';
import type { PlotLayout } from './layout';
import { getTheme, zoneStyle, type Theme } from './theme';
import type { ChartSpec, LevelOverlay, MarkerOverlay, Overlay, ZoneOverlay } from './types';

const ESTIMATED_CHAR_WIDTH = 0.62;

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function estimateWidth(text: string, fontSize: number): number {
  return text.length * ESTIMATED_CHAR_WIDTH * fontSize;
}

function fmtTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Clip helper: keep x within the plot area horizontally. */
function clampX(x: number, layout: PlotLayout): number {
  const { area } = layout;
  return Math.max(area.x, Math.min(area.x + area.width, x));
}

function markerPath(o: MarkerOverlay, x: number, y: number, size: number): string {
  switch (o.shape) {
    case 'triangle-up':
      return `M ${x} ${y - size} L ${x - size} ${y + size * 0.8} L ${x + size} ${y + size * 0.8} Z`;
    case 'triangle-down':
      return `M ${x} ${y + size} L ${x - size} ${y - size * 0.8} L ${x + size} ${y - size * 0.8} Z`;
    case 'dot':
      return `M ${x} ${y} m ${-size} 0 a ${size} ${size} 0 1 0 ${size * 2} 0 a ${size} ${size} 0 1 0 ${-size * 2} 0`;
    case 'cross':
      return `M ${x - size} ${y - size} L ${x + size} ${y + size} M ${x + size} ${y - size} L ${x - size} ${y + size}`;
    case 'arrow-up':
      return `M ${x} ${y - size} L ${x - size * 0.7} ${y + size} L ${x + size * 0.7} ${y + size} Z`;
    case 'arrow-down':
      return `M ${x} ${y + size} L ${x - size * 0.7} ${y - size} L ${x + size * 0.7} ${y - size} Z`;
  }
}

function renderZone(o: ZoneOverlay, layout: PlotLayout, theme: Theme, out: string[]): void {
  const style = zoneStyle(o.dir, o.state ?? 'fresh');
  const x1 = layout.xForIndex(layout.indexOfTime(o.fromTime));
  const x2 = o.toTime != null ? layout.xForIndex(layout.indexOfTime(o.toTime)) : layout.area.x + layout.area.width;
  const left = clampX(x1, layout);
  const right = clampX(x2, layout);
  const w = Math.max(1, right - left);
  const yTop = layout.yForPrice(o.top);
  const yBottom = layout.yForPrice(o.bottom);
  const h = Math.max(1, yBottom - yTop);
  out.push(
    `<rect x="${left.toFixed(1)}" y="${yTop.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"${style.dashed ? ` stroke-dasharray="${o.state === 'broken' ? '2 4' : '6 4'}"` : ''} />`
  );
  if (o.label != null && o.label !== '') {
    const fontSize = 12;
    if (estimateWidth(o.label, fontSize) + 8 <= w) {
      out.push(
        `<text x="${(left + 4).toFixed(1)}" y="${(yTop + fontSize).toFixed(1)}" font-size="${fontSize}" fill="${style.labelColor}" opacity="0.9">${esc(o.label)}</text>`
      );
    } else {
      // Zone too narrow to hold its label (fresh POIs hugging the right
      // edge): chip-backed label just left of the rect instead of a
      // truncated "FVG …" fragment.
      const lw = estimateWidth(o.label, fontSize);
      const chipX = Math.max(layout.area.x + 2, left - lw - 12);
      out.push(
        `<rect x="${chipX.toFixed(1)}" y="${(yTop - 2).toFixed(1)}" width="${(lw + 6).toFixed(1)}" height="16" fill="${theme.background}" opacity="0.75" />`
      );
      out.push(
        `<text x="${(chipX + 3).toFixed(1)}" y="${(yTop + fontSize - 2).toFixed(1)}" font-size="${fontSize}" fill="${style.labelColor}">${esc(o.label)}</text>`
      );
    }
  }
}

/**
 * Render a spec to a standalone SVG string.
 *
 * `layoutDefaults` carries the caller's default canvas size (the CLI and
 * HTTP layer agree on 1600×900) so `spec.layout` stays optional.
 */
export function renderSvg(spec: ChartSpec, layoutDefaults = { width: 1600, height: 900 }): string {
  const theme = getTheme(spec.layout?.theme);
  const layout = computeLayout(spec, layoutDefaults);
  const { area } = layout;
  const parts: string[] = [];

  // Background.
  parts.push(`<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${theme.background}" />`);

  // Bands (behind everything).
  for (const o of spec.overlays) {
    if (o.type !== 'band') continue;
    const x1 = clampX(layout.xForIndex(layout.indexOfTime(o.fromTime)), layout);
    const x2 = o.toTime != null ? clampX(layout.xForIndex(layout.indexOfTime(o.toTime)), layout) : area.x + area.width;
    parts.push(
      `<rect x="${x1.toFixed(1)}" y="${area.y}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="${area.height}" fill="${o.color ?? theme.bandFill}" />`
    );
  }

  // Grid: price ticks + time ticks.
  for (const tick of layout.priceTicks) {
    parts.push(
      `<line x1="${area.x}" y1="${tick.y.toFixed(1)}" x2="${area.x + area.width}" y2="${tick.y.toFixed(1)}" stroke="${theme.grid}" stroke-width="1" />`
    );
  }
  for (const tick of layout.timeTicks) {
    parts.push(
      `<line x1="${tick.x.toFixed(1)}" y1="${area.y}" x2="${tick.x.toFixed(1)}" y2="${area.y + area.height}" stroke="${theme.grid}" stroke-width="1" />`
    );
  }

  // Zones (under candles).
  for (const o of spec.overlays) {
    if (o.type === 'zone') renderZone(o, layout, theme, parts);
  }

  // Candles.
  const bodyWidth = Math.max(1, Math.min(layout.barSlotWidth * 0.7, 9));
  for (let i = 0; i < spec.bars.length; i++) {
    const bar = spec.bars[i]!;
    const x = layout.xForIndex(i);
    const up = bar.close >= bar.open;
    const color = up ? theme.bullWick : theme.bearWick;
    const bodyColor = up ? theme.bullBody : theme.bearBody;
    const yHigh = layout.yForPrice(bar.high);
    const yLow = layout.yForPrice(bar.low);
    const yOpen = layout.yForPrice(bar.open);
    const yClose = layout.yForPrice(bar.close);
    const yTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1" />`
    );
    parts.push(
      `<rect x="${(x - bodyWidth / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}" fill="${bodyColor}" />`
    );
  }

  // Polylines.
  for (const o of spec.overlays) {
    if (o.type !== 'polyline' || o.points.length < 2) continue;
    const points = o.points
      .map((p) => `${clampX(layout.xForIndex(layout.indexOfTime(p.time)), layout).toFixed(1)},${layout.yForPrice(p.price).toFixed(1)}`)
      .join(' ');
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${o.color ?? theme.accent}" stroke-width="2"${o.dashed ? ' stroke-dasharray="6 4"' : ''} stroke-linejoin="round" />`
    );
  }

  // Brackets (risk/reward geometry).
  for (const o of spec.overlays) {
    if (o.type !== 'bracket') continue;
    const x1 = clampX(layout.xForIndex(layout.indexOfTime(o.startTime)), layout);
    const x2 = o.endTime != null ? clampX(layout.xForIndex(layout.indexOfTime(o.endTime)), layout) : area.x + area.width;
    const w = Math.max(1, x2 - x1);
    const yEntry = layout.yForPrice(o.entry);
    const yStop = layout.yForPrice(o.stop);
    const yTarget = layout.yForPrice(o.target);
    const riskTop = Math.min(yEntry, yStop);
    const riskH = Math.max(1, Math.abs(yStop - yEntry));
    const rewardTop = Math.min(yEntry, yTarget);
    const rewardH = Math.max(1, Math.abs(yTarget - yEntry));
    parts.push(`<rect x="${x1.toFixed(1)}" y="${riskTop.toFixed(1)}" width="${w.toFixed(1)}" height="${riskH.toFixed(1)}" fill="${theme.riskFill}" />`);
    parts.push(`<rect x="${x1.toFixed(1)}" y="${rewardTop.toFixed(1)}" width="${w.toFixed(1)}" height="${rewardH.toFixed(1)}" fill="${theme.rewardFill}" />`);
    const lines: Array<[number, string, string]> = [
      [o.entry, theme.text, `entry ${o.entry.toFixed(layout.priceDecimals)}`],
      [o.stop, theme.bearBody, `stop ${o.stop.toFixed(layout.priceDecimals)}`],
      [o.target, theme.bullBody, `target ${o.target.toFixed(layout.priceDecimals)}`],
    ];
    for (const [price, color, label] of lines) {
      const y = layout.yForPrice(price);
      parts.push(
        `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3" />`
      );
      parts.push(`<text x="${(x1 + 6).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="12" fill="${color}">${esc(label)}</text>`);
    }
    const rrText = o.rr != null ? `R:R ${o.rr.toFixed(2)}` : (o.label ?? '');
    if (rrText !== '') {
      const midY = (yEntry + (o.dir === 'bull' ? yTarget : yStop)) / 2;
      parts.push(
        `<text x="${(x1 + 6).toFixed(1)}" y="${(midY + 4).toFixed(1)}" font-size="14" font-weight="bold" fill="${theme.text}">${esc(rrText)}</text>`
      );
    }
  }

  // Levels: lines always; labels top-to-bottom with a minimum vertical
  // gap so dense equal-high/low pools don't stamp on each other.
  const levelItems = spec.overlays
    .filter((o): o is LevelOverlay => o.type === 'level')
    .map((o) => ({ o, y: layout.yForPrice(o.price) }))
    .sort((a, b) => a.y - b.y);
  for (const { o, y } of levelItems) {
    parts.push(
      `<line x1="${area.x}" y1="${y.toFixed(1)}" x2="${area.x + area.width}" y2="${y.toFixed(1)}" stroke="${o.color ?? theme.levelDefault}" stroke-width="1"${o.dashed ? ' stroke-dasharray="6 4"' : ''} />`
    );
  }
  let lastLabelY = -Infinity;
  for (const { o, y } of levelItems) {
    if (o.label == null || o.label === '') continue;
    if (y - lastLabelY < 15) continue;
    lastLabelY = y;
    const w = estimateWidth(o.label, 12);
    const x = area.x + area.width - w - 8;
    parts.push(`<rect x="${x.toFixed(1)}" y="${(y - 16).toFixed(1)}" width="${(w + 8).toFixed(1)}" height="16" fill="${theme.background}" opacity="0.75" />`);
    parts.push(`<text x="${(x + 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="12" fill="${o.color ?? theme.levelDefault}">${esc(o.label)}</text>`);
  }

  // Verticals.
  for (const o of spec.overlays) {
    if (o.type !== 'vline') continue;
    const x = clampX(layout.xForIndex(layout.indexOfTime(o.time)), layout);
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${area.y}" x2="${x.toFixed(1)}" y2="${area.y + area.height}" stroke="${o.color ?? theme.accent}" stroke-width="1" stroke-dasharray="4 4" />`
    );
    if (o.label != null && o.label !== '') {
      const w = estimateWidth(o.label, 12) + 6;
      let x2 = x + 4;
      if (x2 + w > area.x + area.width) x2 = area.x + area.width - w;
      parts.push(`<rect x="${x2.toFixed(1)}" y="${(area.y + 4).toFixed(1)}" width="${w.toFixed(1)}" height="16" fill="${theme.background}" opacity="0.75" />`);
      parts.push(`<text x="${(x2 + 3).toFixed(1)}" y="${(area.y + 16).toFixed(1)}" font-size="12" fill="${o.color ?? theme.accent}">${esc(o.label)}</text>`);
    }
  }

  // Markers.
  for (const o of spec.overlays) {
    if (o.type !== 'marker') continue;
    const index = layout.indexOfTime(o.time);
    const bar = spec.bars[index];
    const up = o.shape === 'triangle-up' || o.shape === 'arrow-up';
    const price =
      o.price ?? (bar != null ? (up ? bar.low - (layout.priceMax - layout.priceMin) * 0.012 : bar.high + (layout.priceMax - layout.priceMin) * 0.012) : 0);
    const x = layout.xForIndex(index);
    const y = layout.yForPrice(price);
    const size = Math.max(4, Math.min(9, layout.barSlotWidth * 0.5));
    const fill = o.shape === 'cross' ? 'none' : o.color ?? (up ? theme.bullBody : theme.bearBody);
    const stroke = o.shape === 'cross' ? o.color ?? theme.text : 'none';
    parts.push(
      `<path d="${markerPath(o, x, y, size)}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
    );
    if (o.label != null && o.label !== '') {
      const w = estimateWidth(o.label, 12) + 6;
      // Near the right edge the chip would run off the canvas — pin it
      // to the plot's right boundary instead.
      let lx = x + size + 4;
      if (lx + w > area.x + area.width) lx = area.x + area.width - w;
      parts.push(`<rect x="${lx.toFixed(1)}" y="${(y - 10).toFixed(1)}" width="${w.toFixed(1)}" height="16" fill="${theme.background}" opacity="0.75" />`);
      parts.push(`<text x="${(lx + 3).toFixed(1)}" y="${(y + 2).toFixed(1)}" font-size="12" fill="${o.color ?? theme.text}">${esc(o.label)}</text>`);
    }
  }

  // Freeform text.
  for (const o of spec.overlays) {
    if (o.type !== 'text') continue;
    const x = clampX(layout.xForIndex(layout.indexOfTime(o.time)), layout);
    const y = layout.yForPrice(o.price);
    const anchor = o.anchor === 'right' ? 'end' : 'start';
    const tx = o.anchor === 'right' ? x - 6 : x + 6;
    parts.push(`<text x="${tx.toFixed(1)}" y="${y.toFixed(1)}" font-size="13" fill="${o.color ?? theme.text}" text-anchor="${anchor}">${esc(o.text)}</text>`);
  }

  // Axes.
  for (const tick of layout.priceTicks) {
    parts.push(
      `<text x="${(area.x - 8).toFixed(1)}" y="${(tick.y + 4).toFixed(1)}" font-size="12" fill="${theme.axisText}" text-anchor="end">${esc(tick.label)}</text>`
    );
  }
  for (const tick of layout.timeTicks) {
    parts.push(
      `<text x="${tick.x.toFixed(1)}" y="${(area.y + area.height + 24).toFixed(1)}" font-size="12" fill="${theme.axisText}" text-anchor="middle">${esc(tick.label)}</text>`
    );
  }

  // Title block.
  let titleY = 0;
  if (spec.meta.title != null || spec.meta.subtitle != null) {
    titleY = 30;
    if (spec.meta.title != null) {
      parts.push(`<text x="${area.x}" y="${titleY}" font-size="22" font-weight="bold" fill="${theme.titleText}">${esc(spec.meta.title)}</text>`);
      titleY += 26;
    }
    if (spec.meta.subtitle != null) {
      parts.push(`<text x="${area.x}" y="${titleY}" font-size="14" fill="${theme.mutedText}">${esc(spec.meta.subtitle)}</text>`);
      titleY += 20;
    }
  }

  // Footer: symbol/timeframe/range + provenance.
  const footerLeft = `${spec.meta.symbol} · ${spec.meta.timeframe} · ${fmtTime(spec.meta.from)} → ${fmtTime(spec.meta.to)} · ${spec.meta.barCount} bars`;
  parts.push(
    `<text x="${area.x}" y="${(layout.height - 10).toFixed(1)}" font-size="12" fill="${theme.mutedText}">${esc(footerLeft)}</text>`
  );
  const prov = spec.meta.provenance;
  if (prov?.fn != null) {
    const params = prov.params
      ? Object.entries(prov.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : '';
    const range = prov.start != null ? `${prov.start} → ${prov.end ?? ''}` : '';
    const ltf = prov.ltfTimeframe != null ? ` ltf=${prov.ltfTimeframe}` : '';
    const footerRight = `fn=${prov.fn}${params ? ` ${params}` : ''}${range ? ` ${range}` : ''}${ltf}`;
    const w = estimateWidth(footerRight, 12);
    parts.push(
      `<text x="${(area.x + area.width - w).toFixed(1)}" y="${(layout.height - 10).toFixed(1)}" font-size="12" fill="${theme.mutedText}" text-anchor="start">${esc(footerRight)}</text>`
    );
  }

  // Legend: one chip per distinct zone (dir × state) present.
  if (spec.layout?.hideLegend !== true) {
    const seen = new Map<string, { color: string; label: string }>();
    for (const o of spec.overlays) {
      if (o.type !== 'zone') continue;
      const key = `${o.dir}/${o.state ?? 'fresh'}`;
      if (!seen.has(key)) {
        const style = zoneStyle(o.dir, o.state ?? 'fresh');
        seen.set(key, { color: style.stroke, label: `${o.dir} zone · ${o.state ?? 'fresh'}` });
      }
    }
    let lx = area.x;
    const ly = area.y + area.height + 24 + 18;
    for (const { color, label } of seen.values()) {
      parts.push(`<rect x="${lx.toFixed(1)}" y="${(ly - 10).toFixed(1)}" width="12" height="12" fill="${color}" />`);
      parts.push(`<text x="${(lx + 18).toFixed(1)}" y="${ly.toFixed(1)}" font-size="12" fill="${theme.text}">${esc(label)}</text>`);
      lx += 18 + estimateWidth(label, 12) + 18;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">` +
    parts.join('\n') +
    '</svg>'
  );
}

/** Type re-export so consumers can import overlay types from one place. */
export type { Overlay };
