/**
 * Pane primitive: session high/low boxes aligned with TradingView-style session windows:
 * IANA timezone + local clock (DST-aware via Intl), not fixed UTC hours.
 *
 * Defaults match the built-in "Trading Sessions" indicator (Pine) session strings:
 * - Tokyo:   Asia/Tokyo        09:00–15:00 local
 * - London:  Europe/London     08:30–16:30 local
 * - New York: America/New_York 09:30–16:00 local
 *
 * Colors follow ustec-demo UI (yellow / greenish / blue), not TV’s default palette.
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

/** Same defaults as TradingView script `input.session(...)` for each zone. */
const TOKYO_TZ = 'Asia/Tokyo';
const TOKYO_START_MIN = 9 * 60 + 0;
const TOKYO_END_MIN = 15 * 60 + 0;

const LONDON_TZ = 'Europe/London';
const LONDON_START_MIN = 8 * 60 + 30;
const LONDON_END_MIN = 16 * 60 + 30;

const NY_TZ = 'America/New_York';
const NY_START_MIN = 9 * 60 + 30;
const NY_END_MIN = 16 * 60 + 0;

const NY_BOX_STROKE = 'rgba(41, 98, 255, 0.85)';
const NY_BOX_FILL = 'rgba(41, 98, 255, 0.12)';
const ASIA_BOX_STROKE = 'rgba(234, 179, 8, 0.9)';
const ASIA_BOX_FILL = 'rgba(234, 179, 8, 0.14)';
const LONDON_BOX_STROKE = 'rgba(52, 211, 153, 0.9)';
const LONDON_BOX_FILL = 'rgba(52, 211, 153, 0.14)';

const BOX_LINE_WIDTH = 2;

const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();
const minuteOfDayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getLocalDateKey(utcSec: number, timeZone: string): string {
  let fmt = dateKeyFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatterCache.set(timeZone, fmt);
  }
  return fmt.format(new Date(utcSec * 1000));
}

/** Minute of day [0, 1440) in `timeZone` for this UTC instant. */
function getMinuteOfDay(utcSec: number, timeZone: string): number {
  let fmt = minuteOfDayFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    minuteOfDayFormatterCache.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(utcSec * 1000));
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
  }
  return hour * 60 + minute;
}

/**
 * Half-open local window [startMinute, endMinute): same convention as typical
 * Pine `input.session` end time (last bar inside is one minute before end).
 */
function isInSession(
  utcSec: number,
  timeZone: string,
  startMinute: number,
  endMinute: number
): boolean {
  const mob = getMinuteOfDay(utcSec, timeZone);
  return mob >= startMinute && mob < endMinute;
}

export type WallClockSessionSpec = {
  timeZone: string;
  startMinute: number;
  endMinute: number;
};

/**
 * Build one box per calendar session: local date in `timeZone` while inside the window,
 * min/max price and first/last bar time from data (same idea as the TV script).
 */
export function buildSessionRangesFromWallClock(
  data: { time: number; low: number; high: number }[],
  spec: WallClockSessionSpec
): SessionRange[] {
  if (data.length === 0) return [];
  const { timeZone, startMinute, endMinute } = spec;
  const bySessionDay = new Map<
    string,
    { first: number; last: number; low: number; high: number }
  >();

  for (const point of data) {
    const t = point.time;
    if (!isInSession(t, timeZone, startMinute, endMinute)) continue;
    const dayKey = getLocalDateKey(t, timeZone);
    const cur = bySessionDay.get(dayKey);
    if (!cur) {
      bySessionDay.set(dayKey, {
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

  return Array.from(bySessionDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      start: v.first as UTCTimestamp,
      end: v.last as UTCTimestamp,
      low: v.low,
      high: v.high,
    }));
}

/** One session: start/end times and min/max price during the session. */
export type SessionRange = {
  start: UTCTimestamp;
  end: UTCTimestamp;
  low: number;
  high: number;
};

interface BoxCoords {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

class SessionBoxesRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _boxes: BoxCoords[],
    private _stroke: string,
    private _fill: string
  ) {}

  private drawBoxes(target: CanvasRenderingTarget2D): void {
    if (this._boxes.length === 0) return;
    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const { context: ctx, horizontalPixelRatio: hPR, verticalPixelRatio: vPR } = scope;
        ctx.strokeStyle = this._stroke;
        ctx.fillStyle = this._fill;
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
    private _sessions: SessionRange[],
    private _stroke: string,
    private _fill: string
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
    return new SessionBoxesRenderer(boxes, this._stroke, this._fill);
  }
}

export class SessionBoxesPrimitive implements IPanePrimitive<Time> {
  private _chart: IChartApiBase<Time> | null = null;
  private _view: SessionBoxesPaneView | null = null;

  constructor(
    private _sessions: SessionRange[],
    private _stroke: string,
    private _fill: string
  ) {
    this._view = null;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    if (!this._chart || !this._view) return [];
    return [this._view];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._view = new SessionBoxesPaneView(
      this._chart,
      this._sessions,
      this._stroke,
      this._fill
    );
    param.requestUpdate();
  }

  detached(): void {
    this._chart = null;
    this._view = null;
  }
}

/** @deprecated Use SessionBoxesPrimitive — kept for existing imports. */
export type NYSessionBoxesPrimitive = SessionBoxesPrimitive;

/** Tokyo session (TV "First session" default); ustec-demo colors it yellow as "Asia". */
export function createAsiaSessionBoxesPrimitiveFromData(
  data: { time: number; low: number; high: number }[]
): SessionBoxesPrimitive {
  const sessions = buildSessionRangesFromWallClock(data, {
    timeZone: TOKYO_TZ,
    startMinute: TOKYO_START_MIN,
    endMinute: TOKYO_END_MIN,
  });
  return new SessionBoxesPrimitive(sessions, ASIA_BOX_STROKE, ASIA_BOX_FILL);
}

export function createLondonSessionBoxesPrimitiveFromData(
  data: { time: number; low: number; high: number }[]
): SessionBoxesPrimitive {
  const sessions = buildSessionRangesFromWallClock(data, {
    timeZone: LONDON_TZ,
    startMinute: LONDON_START_MIN,
    endMinute: LONDON_END_MIN,
  });
  return new SessionBoxesPrimitive(sessions, LONDON_BOX_STROKE, LONDON_BOX_FILL);
}

export function createNYSessionBoxesPrimitiveFromData(
  data: { time: number; low: number; high: number }[]
): SessionBoxesPrimitive {
  const sessions = buildSessionRangesFromWallClock(data, {
    timeZone: NY_TZ,
    startMinute: NY_START_MIN,
    endMinute: NY_END_MIN,
  });
  return new SessionBoxesPrimitive(sessions, NY_BOX_STROKE, NY_BOX_FILL);
}
