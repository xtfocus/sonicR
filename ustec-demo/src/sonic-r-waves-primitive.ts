import type {
  IChartApiBase,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  PaneAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { BitmapCoordinatesRenderingScope, CanvasRenderingTarget2D } from 'fancy-canvas';
import type { WavePattern } from './sonic-r-wave';

type CoordSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'bull' | 'bear';
};

const BULL_COLOR = 'rgba(34, 197, 94, 0.85)';
const BEAR_COLOR = 'rgba(239, 83, 80, 0.85)';
const MAX_VISIBLE_WAVES = 40;

class SonicRWavesRenderer implements IPrimitivePaneRenderer {
  constructor(private _segments: CoordSegment[]) {}

  drawBackground(_target: CanvasRenderingTarget2D): void {
    // no-op
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this._segments.length === 0) return;

    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      const { context: ctx, horizontalPixelRatio: hPR, verticalPixelRatio: vPR } = scope;
      const lineWidth = Math.max(1, Math.floor(2 * hPR));

      for (const s of this._segments) {
        ctx.beginPath();
        ctx.strokeStyle = s.direction === 'bull' ? BULL_COLOR : BEAR_COLOR;
        ctx.lineWidth = lineWidth;
        ctx.moveTo(Math.round(s.x1 * hPR), Math.round(s.y1 * vPR));
        ctx.lineTo(Math.round(s.x2 * hPR), Math.round(s.y2 * vPR));
        ctx.stroke();
      }
    });
  }
}

class SonicRWavesPaneView implements IPanePrimitivePaneView {
  constructor(
    private _chart: IChartApiBase<Time>,
    private _waves: WavePattern[]
  ) {}

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    if (this._waves.length === 0) return null;

    const panes = this._chart.panes();
    if (panes.length === 0) return null;
    const series = panes[0]!.getSeries();
    const anySeries = series[0];
    if (!anySeries) return null;

    const timeScale = this._chart.timeScale();
    const visible = timeScale.getVisibleRange();
    if (!visible) return null;

    const from = visible.from as number;
    const to = visible.to as number;

    const candidates = this._waves
      .filter((w) => {
        const t = w.leg3End.time as number;
        return t >= from && t <= to;
      })
      .slice(0, MAX_VISIBLE_WAVES);

    if (candidates.length === 0) return null;

    const toX = (time: number) => timeScale.timeToCoordinate(time as Time);
    const toY = (price: number) => anySeries.priceToCoordinate(price) as number | null;

    const out: CoordSegment[] = [];

    for (const w of candidates) {
      const pivots = [w.leg1Start, w.leg1End, w.leg2End, w.leg3End];
      for (let i = 0; i < pivots.length - 1; i++) {
        const a = pivots[i]!;
        const b = pivots[i + 1]!;
        const x1 = toX(a.time as number);
        const y1 = toY(a.price);
        const x2 = toX(b.time as number);
        const y2 = toY(b.price);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        out.push({ x1, y1, x2, y2, direction: w.direction });
      }
    }

    if (out.length === 0) return null;
    return new SonicRWavesRenderer(out);
  }
}

export class SonicRWavesPrimitive implements IPanePrimitive<Time> {
  private _view: SonicRWavesPaneView | null = null;

  constructor(private _waves: WavePattern[]) {}

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._view = new SonicRWavesPaneView(param.chart, this._waves);
    param.requestUpdate();
  }

  detached(): void {
    this._view = null;
  }
}
