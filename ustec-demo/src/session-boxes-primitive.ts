/**
 * Pane primitive that draws boundary boxes for each New York session.
 * NY session in UTC: 14:00 → 22:00 (data is already in UTC).
 */

import type {
  IChartApiBase,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  PaneAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type {
  BitmapCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
} from 'fancy-canvas';

const NY_START_HOUR = 14;
const NY_END_HOUR = 22;
const BOX_STROKE = 'rgba(41, 98, 255, 0.85)';
const BOX_FILL = 'rgba(41, 98, 255, 0.12)';
const BOX_LINE_WIDTH = 2;

/** One session: start/end times and min/max price during the session. */
export type SessionRange = {
  start: UTCTimestamp;
  end: UTCTimestamp;
  low: number;
  high: number;
};

const ONE_DAY = 24 * 60 * 60;
const NY_START_OFFSET = NY_START_HOUR * 60 * 60;
const NY_END_OFFSET = NY_END_HOUR * 60 * 60;

/**
 * Build session ranges from actual candle data: times and min/max price per session.
 * For each calendar day, finds first bar >= 14:00 UTC, last bar <= 22:00 UTC,
 * and the min low / max high over that session.
 */
export function buildSessionRangesFromData(
  data: { time: number; low: number; high: number }[]
): SessionRange[] {
  if (data.length === 0) return [];
  const byDay = new Map<
    number,
    { first: number; last: number; low: number; high: number }
  >();
  for (const point of data) {
    const t = point.time;
    const dayStart = Math.floor(t / ONE_DAY) * ONE_DAY;
    const sessionStart = dayStart + NY_START_OFFSET;
    const sessionEnd = dayStart + NY_END_OFFSET;
    if (t < sessionStart || t > sessionEnd) continue;
    const cur = byDay.get(dayStart);
    if (!cur) {
      byDay.set(dayStart, {
        first: t,
        last: t,
        low: point.low,
        high: point.high,
      });
    } else {
      cur.first = Math.min(cur.first, t);
      cur.last = Math.max(cur.last, t);
      cur.low = Math.min(cur.low, point.low);
      cur.high = Math.max(cur.high, point.high);
    }
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      start: v.first as UTCTimestamp,
      end: v.last as UTCTimestamp,
      low: v.low,
      high: v.high,
    }));
}

interface BoxCoords {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

class SessionBoxesRenderer implements IPrimitivePaneRenderer {
  constructor(private _boxes: BoxCoords[]) {}

  private drawBoxes(target: CanvasRenderingTarget2D): void {
    if (this._boxes.length === 0) return;
    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const { context: ctx, horizontalPixelRatio: hPR, verticalPixelRatio: vPR } = scope;
        ctx.strokeStyle = BOX_STROKE;
        ctx.fillStyle = BOX_FILL;
        ctx.lineWidth = Math.max(1, Math.floor(BOX_LINE_WIDTH * hPR));
        for (const b of this._boxes) {
          const x1 = Math.round(b.x1 * hPR);
          const x2 = Math.round(b.x2 * hPR);
          const w = Math.max(1, x2 - x1);
          const yTop = Math.round(Math.min(b.y1, b.y2) * vPR);
          const yBottom = Math.round(Math.max(b.y1, b.y2) * vPR);
          const h = Math.max(1, yBottom - yTop);
          ctx.fillRect(x1, yTop, w, h);
          ctx.strokeRect(x1, yTop, w, h);
        }
      }
    );
  }

  draw(target: CanvasRenderingTarget2D): void {
    this.drawBoxes(target);
  }

  drawBackground(target: CanvasRenderingTarget2D): void {
    this.drawBoxes(target);
  }
}

class SessionBoxesPaneView implements IPanePrimitivePaneView {
  constructor(
    private _chart: IChartApiBase<Time>,
    private _sessions: SessionRange[]
  ) {}

  // Use 'normal' so we're in paneViews(); 'bottom' is not returned by the pane primitive wrapper in this API
  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    const timeScale = this._chart.timeScale();
    const panes = this._chart.panes();
    if (panes.length === 0) return null;
    const series = panes[0].getSeries();
    const mainSeries = series[0];
    if (!mainSeries) return null;
    const priceToY = (p: number) => mainSeries.priceToCoordinate(p) as number | null;
    const boxes: BoxCoords[] = [];
    for (const s of this._sessions) {
      const x1 = timeScale.timeToCoordinate(s.start as Time);
      const x2 = timeScale.timeToCoordinate(s.end as Time);
      const yLow = priceToY(s.low);
      const yHigh = priceToY(s.high);
      if (x1 == null || x2 == null || yLow == null || yHigh == null) continue;
      boxes.push({
        x1: Math.min(x1 as number, x2 as number),
        x2: Math.max(x1 as number, x2 as number),
        y1: yLow,
        y2: yHigh,
      });
    }
    return new SessionBoxesRenderer(boxes);
  }
}

export class NYSessionBoxesPrimitive implements IPanePrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _view: SessionBoxesPaneView | null = null;

  constructor(private _sessions: SessionRange[]) {
    this._view = null;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._chart || !this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._view = new SessionBoxesPaneView(this._chart, this._sessions);
    param.requestUpdate();
  }

  detached(): void {
    this._chart = null;
    this._view = null;
  }
}

/**
 * Create NY session boxes using session times and min/max price from the actual candle data.
 */
export function createNYSessionBoxesPrimitiveFromData(
  data: { time: number; low: number; high: number }[]
): NYSessionBoxesPrimitive {
  const sessions = buildSessionRangesFromData(data);
  return new NYSessionBoxesPrimitive(sessions);
}
