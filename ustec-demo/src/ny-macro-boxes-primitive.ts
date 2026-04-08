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

const BOX_STROKE = 'rgba(186, 104, 200, 0.9)';
const BOX_FILL = 'rgba(186, 104, 200, 0.16)';
const BOX_LINE_WIDTH = 2;

type MacroWindow = {
  id: string;
  startMinute: number;
  endMinute: number;
};

// New York local-time windows.
const NY_MACRO_WINDOWS: MacroWindow[] = [
  { id: 'ny-am-1', startMinute: 8 * 60 + 50, endMinute: 9 * 60 + 10 },
  { id: 'ny-am-2', startMinute: 9 * 60 + 50, endMinute: 10 * 60 + 10 },
  { id: 'ny-am-3', startMinute: 10 * 60 + 50, endMinute: 11 * 60 + 10 },
  { id: 'ny-midday', startMinute: 11 * 60 + 50, endMinute: 12 * 60 + 10 },
  { id: 'ny-pm', startMinute: 13 * 60 + 10, endMinute: 13 * 60 + 40 },
  { id: 'ny-close', startMinute: 15 * 60 + 15, endMinute: 15 * 60 + 45 },
];

export type MacroRange = {
  start: UTCTimestamp;
  end: UTCTimestamp;
  low: number;
  high: number;
};

const nyPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function getNyDateTimeParts(utcSec: number): {
  dayKey: string;
  minuteOfDay: number;
} {
  const parts = nyPartsFormatter.formatToParts(new Date(utcSec * 1000));
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return {
    dayKey: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
  };
}

export function buildNyMacroRangesFromData(
  data: { time: number; low: number; high: number }[]
): MacroRange[] {
  if (data.length === 0) return [];

  const groups = new Map<
    string,
    { first: number; last: number; low: number; high: number }
  >();

  for (const point of data) {
    const { dayKey, minuteOfDay } = getNyDateTimeParts(point.time);
    for (const win of NY_MACRO_WINDOWS) {
      if (minuteOfDay < win.startMinute || minuteOfDay > win.endMinute) continue;
      const key = `${dayKey}|${win.id}`;
      const cur = groups.get(key);
      if (!cur) {
        groups.set(key, {
          first: point.time,
          last: point.time,
          low: point.low,
          high: point.high,
        });
      } else {
        cur.first = Math.min(cur.first, point.time);
        cur.last = Math.max(cur.last, point.time);
        cur.low = Math.min(cur.low, point.low);
        cur.high = Math.max(cur.high, point.high);
      }
      break;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.first - b.first)
    .map((v) => ({
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

class MacroBoxesRenderer implements IPrimitivePaneRenderer {
  constructor(private _boxes: BoxCoords[]) {}

  private drawBoxes(target: CanvasRenderingTarget2D): void {
    if (this._boxes.length === 0) return;
    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
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
    });
  }

  draw(target: CanvasRenderingTarget2D): void {
    this.drawBoxes(target);
  }

  drawBackground(target: CanvasRenderingTarget2D): void {
    this.drawBoxes(target);
  }
}

class MacroBoxesPaneView implements IPanePrimitivePaneView {
  constructor(
    private _chart: IChartApiBase<Time>,
    private _ranges: MacroRange[]
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
    const boxes: BoxCoords[] = [];
    for (const r of this._ranges) {
      const x1 = timeScale.timeToCoordinate(r.start as Time);
      const x2 = timeScale.timeToCoordinate(r.end as Time);
      const yLow = priceToY(r.low);
      const yHigh = priceToY(r.high);
      if (x1 == null || x2 == null || yLow == null || yHigh == null) continue;
      boxes.push({
        x1: Math.min(x1 as number, x2 as number),
        x2: Math.max(x1 as number, x2 as number),
        y1: yLow,
        y2: yHigh,
      });
    }
    return new MacroBoxesRenderer(boxes);
  }
}

export class NYMacroBoxesPrimitive implements IPanePrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _view: MacroBoxesPaneView | null = null;

  constructor(private _ranges: MacroRange[]) {}

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._chart || !this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._view = new MacroBoxesPaneView(this._chart, this._ranges);
    param.requestUpdate();
  }

  detached(): void {
    this._chart = null;
    this._view = null;
  }
}

export function createNYMacroBoxesPrimitiveFromData(
  data: { time: number; low: number; high: number }[]
): NYMacroBoxesPrimitive {
  const ranges = buildNyMacroRangesFromData(data);
  return new NYMacroBoxesPrimitive(ranges);
}
