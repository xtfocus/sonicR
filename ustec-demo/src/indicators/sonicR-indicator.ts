import { LineSeries } from 'lightweight-charts';
import { createSeriesMarkers } from 'lightweight-charts';
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { SonicRComputed } from '../sonic-r-ema';
import { DragonFillPrimitive } from '../dragon-fill-primitive';
import type { SonicRSignal } from '../sonic-r-entry';
import type { IndicatorController } from './types';

const DRAGON_LINE_COLOR = 'rgba(41, 98, 255, 0.55)';
const DRAGON_CENTER_COLOR = 'rgba(41, 98, 255, 0.95)';
const EMA89_COLOR = 'rgba(239, 83, 80, 0.95)';

export class SonicRIndicator implements IndicatorController {
  readonly id = 'sonicR';

  private _enabled = false;
  private _lastIntervalSeconds = 60;

  private _emaLow34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _emaHigh34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _emaClose34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _ema89Series!: ReturnType<IChartApiBase<Time>['addSeries']>;

  private _dragonFillPrimitive: DragonFillPrimitive | null = null;
  private _seriesMarkersPlugin!: ISeriesMarkersPluginApi<Time>;

  constructor(
    private _chart: IChartApiBase<Time>,
    private _candleSeries: ISeriesApi<'Candlestick', Time>,
    private _sonicRByIntervalSeconds: Map<number, SonicRComputed>,
    private _entriesByIntervalSeconds: Map<number, SonicRSignal[]>
  ) {
    // NOTE: do NOT create series in field initializers. `useDefineForClassFields`
    // means they run before the constructor body, when `_chart` is still undefined.
    this._emaLow34Series = this._chart.addSeries(LineSeries, {
      color: DRAGON_LINE_COLOR,
      lineWidth: 1,
      lineStyle: 0,
    });

    this._emaHigh34Series = this._chart.addSeries(LineSeries, {
      color: DRAGON_LINE_COLOR,
      lineWidth: 1,
      lineStyle: 0,
    });

    this._emaClose34Series = this._chart.addSeries(LineSeries, {
      color: DRAGON_CENTER_COLOR,
      lineWidth: 2,
      lineStyle: 0,
    });

    this._ema89Series = this._chart.addSeries(LineSeries, {
      color: EMA89_COLOR,
      lineWidth: 3,
      lineStyle: 0,
    });

    // Start hidden until toggled on.
    this._emaLow34Series.setData([]);
    this._emaHigh34Series.setData([]);
    this._emaClose34Series.setData([]);
    this._ema89Series.setData([]);

    this._seriesMarkersPlugin = createSeriesMarkers(this._candleSeries, [], {
      // Keep markers visible even when the chart re-scales during zoom.
      // Otherwise the pivot markers can fall outside the visible price range.
      autoScale: true,
      zOrder: 'aboveSeries',
    });
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this._emaLow34Series.setData([]);
      this._emaHigh34Series.setData([]);
      this._emaClose34Series.setData([]);
      this._ema89Series.setData([]);

      const pane = this._chart.panes()[0];
      if (pane && this._dragonFillPrimitive) pane.detachPrimitive(this._dragonFillPrimitive);
      this._dragonFillPrimitive = null;

      this._seriesMarkersPlugin.setMarkers([]);
      return;
    }

    this.onTimeframe(this._lastIntervalSeconds);
  }

  onTimeframe(intervalSeconds: number): void {
    this._lastIntervalSeconds = intervalSeconds;
    if (!this._enabled) return;

    const computed = this._sonicRByIntervalSeconds.get(intervalSeconds);
    if (!computed) return;

    const pane = this._chart.panes()[0];

    this._emaLow34Series.setData(computed.emaLow34 as any);
    this._emaHigh34Series.setData(computed.emaHigh34 as any);
    this._emaClose34Series.setData(computed.emaClose34 as any);
    this._ema89Series.setData(computed.ema89 as any);

    if (this._dragonFillPrimitive) pane.detachPrimitive(this._dragonFillPrimitive);
    this._dragonFillPrimitive = new DragonFillPrimitive(computed.dragonFillPoints);
    pane.attachPrimitive(this._dragonFillPrimitive);

    // Render entry triggers (BUY/SELL) derived from Sonic R filters.
    const entries = this._entriesByIntervalSeconds.get(intervalSeconds) ?? [];
    const markers = entries.map((s) => {
      const isBuy = s.side === 'buy';
      return {
        time: s.time as UTCTimestamp,
        position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
        shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
        color: isBuy ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 83, 80, 0.95)',
        text: isBuy ? 'BUY' : 'SELL',
      };
    });

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    this._seriesMarkersPlugin.setMarkers(markers);
  }
}

