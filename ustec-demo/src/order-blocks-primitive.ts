import type {
  IChartApiBase,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  PaneAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { BitmapCoordinatesRenderingScope, CanvasRenderingTarget2D } from 'fancy-canvas';
import type { ComputedOrderBlock } from './sonic-r-order-blocks';

const BULL_FILL = 'rgba(22, 148, 0, 0.09)';
const BULL_STROKE = 'rgba(22, 148, 0, 0.45)';
const BEAR_FILL = 'rgba(255, 17, 0, 0.09)';
const BEAR_STROKE = 'rgba(255, 17, 0, 0.45)';
const AVG_LINE = 'rgba(149, 152, 161, 0.55)';
const STROKE_WIDTH = 1;
const AVG_WIDTH = 1;

type DrawBox = {
  x1: number;
  x2: number;
  yTop: number;
  yBottom: number;
  yAvg: number;
  bull: boolean;
};

class OrderBlocksRenderer implements IPrimitivePaneRenderer {
  constructor(private _boxes: DrawBox[]) {}

  private renderAll(target: CanvasRenderingTarget2D): void {
    if (this._boxes.length === 0) return;
    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      const { context: ctx, horizontalPixelRatio: hPR, verticalPixelRatio: vPR } = scope;
      ctx.lineWidth = Math.max(1, Math.floor(STROKE_WIDTH * hPR));
      for (const b of this._boxes) {
        const x1 = Math.round(Math.min(b.x1, b.x2) * hPR);
        const x2 = Math.round(Math.max(b.x1, b.x2) * hPR);
        const w = Math.max(1, x2 - x1);
        const yTop = Math.round(Math.min(b.yTop, b.yBottom) * vPR);
        const yBottom = Math.round(Math.max(b.yTop, b.yBottom) * vPR);
        const h = Math.max(1, yBottom - yTop);
        ctx.fillStyle = b.bull ? BULL_FILL : BEAR_FILL;
        ctx.strokeStyle = b.bull ? BULL_STROKE : BEAR_STROKE;
        ctx.fillRect(x1, yTop, w, h);
        ctx.strokeRect(x1, yTop, w, h);

        const yAvg = Math.round(b.yAvg * vPR);
        ctx.strokeStyle = AVG_LINE;
        ctx.lineWidth = Math.max(1, Math.floor(AVG_WIDTH * hPR));
        ctx.setLineDash([4 * hPR, 3 * hPR]);
        ctx.beginPath();
        ctx.moveTo(x1, yAvg);
        ctx.lineTo(x2, yAvg);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  draw(target: CanvasRenderingTarget2D): void {
    this.renderAll(target);
  }

  drawBackground(target: CanvasRenderingTarget2D): void {
    this.renderAll(target);
  }
}

class OrderBlocksPaneView implements IPanePrimitivePaneView {
  constructor(
    private _chart: IChartApiBase<Time>,
    private _blocks: ComputedOrderBlock[]
  ) {}

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

    const draw: DrawBox[] = [];
    for (const b of this._blocks) {
      const x1 = timeScale.timeToCoordinate(b.leftTime as Time);
      const x2 = timeScale.timeToCoordinate(b.rightTime as Time);
      const yTop = priceToY(b.top);
      const yBottom = priceToY(b.bottom);
      const yAvg = priceToY(b.avg);
      if (x1 == null || x2 == null || yTop == null || yBottom == null || yAvg == null) continue;
      draw.push({
        x1: x1 as number,
        x2: x2 as number,
        yTop,
        yBottom,
        yAvg,
        bull: b.side === 'bull',
      });
    }
    return new OrderBlocksRenderer(draw);
  }
}

export class OrderBlocksPrimitive implements IPanePrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _view: OrderBlocksPaneView | null = null;

  constructor(private _blocks: ComputedOrderBlock[]) {}

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._chart || !this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._view = new OrderBlocksPaneView(this._chart, this._blocks);
    param.requestUpdate();
  }

  detached(): void {
    this._chart = null;
    this._view = null;
  }
}
