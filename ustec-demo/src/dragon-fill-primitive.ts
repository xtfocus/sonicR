import type {
  IChartApiBase,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  PaneAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { BitmapCoordinatesRenderingScope, CanvasRenderingTarget2D } from 'fancy-canvas';

export type DragonFillPoint = {
  time: UTCTimestamp;
  lowValue: number;
  highValue: number;
};

type CoordPoint = {
  x: number;
  yHigh: number;
  yLow: number;
};

const FILL_COLOR = 'rgba(41, 98, 255, 0.10)';
const STROKE_COLOR = 'rgba(41, 98, 255, 0.25)';

function lowerBound(points: DragonFillPoint[], time: number): number {
  let l = 0;
  let r = points.length;
  while (l < r) {
    const m = (l + r) >> 1;
    if (points[m]!.time < time) l = m + 1;
    else r = m;
  }
  return l;
}

class DragonFillRenderer implements IPrimitivePaneRenderer {
  constructor(private _points: CoordPoint[]) {}

  drawBackground(target: CanvasRenderingTarget2D): void {
    if (this._points.length < 2) return;

    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const { context: ctx, horizontalPixelRatio: hPR, verticalPixelRatio: vPR } = scope;

        ctx.fillStyle = FILL_COLOR;
        ctx.strokeStyle = STROKE_COLOR;
        ctx.lineWidth = Math.max(1, Math.floor(1 * hPR));

        const toX = (x: number) => Math.round(x * hPR);
        const toY = (y: number) => Math.round(y * vPR);

        ctx.beginPath();

        // Upper boundary (left -> right).
        for (let i = 0; i < this._points.length; i++) {
          const p = this._points[i]!;
          const x = toX(p.x);
          const y = toY(p.yHigh);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        // Lower boundary (right -> left).
        for (let i = this._points.length - 1; i >= 0; i--) {
          const p = this._points[i]!;
          const x = toX(p.x);
          const y = toY(p.yLow);
          ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.fill();
        // Optional subtle outline to help readability on flat charts.
        ctx.stroke();
      }
    );
  }

  draw(_target: CanvasRenderingTarget2D): void {
    // no-op
  }
}

class DragonFillPaneView implements IPanePrimitivePaneView {
  constructor(
    private _chart: IChartApiBase<Time>,
    private _fillPoints: DragonFillPoint[]
  ) {}

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer | null {
    if (this._fillPoints.length < 2) return null;

    const timeScale = this._chart.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return null;

    const from = visibleRange.from as number;
    const to = visibleRange.to as number;
    if (from == null || to == null) return null;

    const leftIdx = lowerBound(this._fillPoints, from);
    // Find the first point with time > to, then step back by 1 for inclusive slicing.
    const rightIdxExclusive = lowerBound(this._fillPoints, to + 1);
    const rightIdx = Math.max(leftIdx, rightIdxExclusive - 1);
    if (leftIdx > rightIdx) return null;

    const panes = this._chart.panes();
    if (panes.length === 0) return null;

    // Any series in the pane shares the same price scale => same mapping.
    const series = panes[0]!.getSeries();
    const anySeries = series[0];
    if (!anySeries) return null;

    const priceToY = (p: number) => anySeries.priceToCoordinate(p) as number | null;

    const coords: CoordPoint[] = [];
    for (let i = leftIdx; i <= rightIdx; i++) {
      const pt = this._fillPoints[i]!;
      const x = timeScale.timeToCoordinate(pt.time);
      const yHigh = priceToY(pt.highValue);
      const yLow = priceToY(pt.lowValue);
      if (x == null || yHigh == null || yLow == null) continue;

      coords.push({ x: x as number, yHigh, yLow });
    }

    if (coords.length < 2) return null;
    return new DragonFillRenderer(coords);
  }
}

export class DragonFillPrimitive implements IPanePrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _view: DragonFillPaneView | null = null;

  constructor(private _fillPoints: DragonFillPoint[]) {}

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._chart || !this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._view = new DragonFillPaneView(this._chart, this._fillPoints);
    param.requestUpdate();
  }

  detached(): void {
    this._chart = null;
    this._view = null;
  }
}

