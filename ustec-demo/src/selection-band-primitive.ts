/**
 * Pane primitive: full-height selection band for the data selector tool.
 *
 * Draws a semi-transparent band plus solid edge lines between two bar times.
 * Follows the same pattern as session-boxes-primitive, but the range is
 * mutable so the tool can update it live while dragging.
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

/** Selected time range, inclusive on both ends (start <= end). */
export type SelectionRange = {
  start: UTCTimestamp;
  end: UTCTimestamp;
};

const BAND_FILL = 'rgba(88, 124, 255, 0.10)';
const EDGE_COLOR = 'rgba(88, 124, 255, 0.9)';
const EDGE_LINE_WIDTH = 2;

class SelectionBandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _x1: number,
    private _x2: number
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const {
          context: ctx,
          horizontalPixelRatio: hPR,
          verticalPixelRatio: vPR,
          mediaSize,
        } = scope;
        const x1 = Math.round(Math.min(this._x1, this._x2) * hPR);
        const x2 = Math.round(Math.max(this._x1, this._x2) * hPR);
        const width = x2 - x1;
        if (width < 1) return;
        const height = Math.ceil(mediaSize.height * vPR);

        ctx.fillStyle = BAND_FILL;
        ctx.fillRect(x1, 0, width, height);

        ctx.strokeStyle = EDGE_COLOR;
        ctx.lineWidth = Math.max(1, Math.floor(EDGE_LINE_WIDTH * hPR));
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, 0);
        ctx.lineTo(x1 + 0.5, height);
        ctx.moveTo(x2 - 0.5, 0);
        ctx.lineTo(x2 - 0.5, height);
        ctx.stroke();
      }
    );
  }
}

class SelectionBandPaneView implements IPanePrimitivePaneView {
  constructor(
    private _chart: IChartApiBase<Time>,
    private _getRange: () => SelectionRange | null
  ) {}

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer | null {
    const range = this._getRange();
    if (!range) return null;
    const timeScale = this._chart.timeScale();
    const x1 = timeScale.timeToCoordinate(range.start as Time);
    const x2 = timeScale.timeToCoordinate(range.end as Time);
    if (x1 == null || x2 == null) return null;
    return new SelectionBandRenderer(x1, x2);
  }
}

export class SelectionBandPrimitive implements IPanePrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _view: SelectionBandPaneView | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _range: SelectionRange | null = null;

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._chart || !this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
    this._view = new SelectionBandPaneView(this._chart, () => this._range);
    this._requestUpdate();
  }

  detached(): void {
    this._chart = null;
    this._view = null;
    this._requestUpdate = null;
  }

  /** Set (or clear with null) the band range and request a repaint. */
  setRange(range: SelectionRange | null): void {
    this._range = range;
    this._requestUpdate?.();
  }
}
