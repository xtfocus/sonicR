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
import type { WavePattern } from '../sonic-r-wave';
import { SonicRWavesPrimitive } from '../sonic-r-waves-primitive';
import type { IndicatorController } from './types';

const DRAGON_LINE_COLOR = 'rgba(41, 98, 255, 0.55)';
const DRAGON_CENTER_COLOR = 'rgba(41, 98, 255, 0.95)';
const EMA89_COLOR = 'rgba(239, 83, 80, 0.95)';

export class SonicRIndicator implements IndicatorController {
  readonly id = 'sonicR';

  private _enabled = false;
  private _showWaves = true;
  private _lastIntervalSeconds = 60;

  private _emaLow34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _emaHigh34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _emaClose34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _ema89Series!: ReturnType<IChartApiBase<Time>['addSeries']>;

  private _dragonFillPrimitive: DragonFillPrimitive | null = null;
  private _wavesPrimitive: SonicRWavesPrimitive | null = null;
  private _seriesMarkersPlugin!: ISeriesMarkersPluginApi<Time>;
  private _signalsByTime = new Map<number, SonicRSignal>();
  private _tooltipEl: HTMLDivElement;

  constructor(
    private _chart: IChartApiBase<Time>,
    private _candleSeries: ISeriesApi<'Candlestick', Time>,
    private _sonicRByIntervalSeconds: Map<number, SonicRComputed>,
    private _entriesByIntervalSeconds: Map<number, SonicRSignal[]>,
    private _wavesByIntervalSeconds: Map<number, WavePattern[]>,
    private _chartContainer: HTMLElement
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

    this._tooltipEl = document.createElement('div');
    this._tooltipEl.style.position = 'absolute';
    this._tooltipEl.style.zIndex = '20';
    this._tooltipEl.style.pointerEvents = 'none';
    this._tooltipEl.style.background = 'rgba(15, 21, 32, 0.96)';
    this._tooltipEl.style.border = '1px solid #2a3551';
    this._tooltipEl.style.borderRadius = '8px';
    this._tooltipEl.style.color = '#d1d4dc';
    this._tooltipEl.style.padding = '8px 10px';
    this._tooltipEl.style.fontSize = '12px';
    this._tooltipEl.style.lineHeight = '1.4';
    this._tooltipEl.style.whiteSpace = 'pre-line';
    this._tooltipEl.style.display = 'none';
    document.body.appendChild(this._tooltipEl);

    this._chart.subscribeCrosshairMove((param: any) => {
      this._onCrosshairMove(param);
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
      if (pane && this._wavesPrimitive) pane.detachPrimitive(this._wavesPrimitive);
      this._wavesPrimitive = null;
      this._signalsByTime.clear();
      this._hideTooltip();

      this._seriesMarkersPlugin.setMarkers([]);
      return;
    }

    this.onTimeframe(this._lastIntervalSeconds);
  }

  setShowWaves(showWaves: boolean): void {
    this._showWaves = showWaves;
    if (this._enabled) this.onTimeframe(this._lastIntervalSeconds);
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

    if (this._wavesPrimitive) pane.detachPrimitive(this._wavesPrimitive);
    this._wavesPrimitive = null;
    const waves = this._wavesByIntervalSeconds.get(intervalSeconds) ?? [];
    if (this._showWaves) {
      this._wavesPrimitive = new SonicRWavesPrimitive(waves);
      pane.attachPrimitive(this._wavesPrimitive);
    }

    // Render entry triggers (BUY/SELL) and optional wave leg labels.
    const entries = this._entriesByIntervalSeconds.get(intervalSeconds) ?? [];
    this._signalsByTime = new Map(entries.map((s) => [s.time as number, s]));
    const entryMarkers = entries.map((s) => {
      const isBuy = s.side === 'buy';
      return {
        time: s.time as UTCTimestamp,
        position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
        shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
        color: isBuy ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 83, 80, 0.95)',
        text: isBuy ? 'BUY' : 'SELL',
      };
    });

    const waveMarkers = this._showWaves
      ? waves.flatMap((w) => {
          const prefix = w.direction === 'bull' ? 'B' : 'S';
          const color = w.direction === 'bull' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 83, 80, 0.95)';
          return [
            {
              time: w.leg1End.time as UTCTimestamp,
              position: w.direction === 'bull' ? ('aboveBar' as const) : ('belowBar' as const),
              shape: 'circle' as const,
              color,
              text: `${prefix}1`,
            },
            {
              time: w.leg2End.time as UTCTimestamp,
              position: w.direction === 'bull' ? ('belowBar' as const) : ('aboveBar' as const),
              shape: 'circle' as const,
              color,
              text: `${prefix}2`,
            },
            {
              time: w.leg3End.time as UTCTimestamp,
              position: w.direction === 'bull' ? ('aboveBar' as const) : ('belowBar' as const),
              shape: 'circle' as const,
              color,
              text: `${prefix}3`,
            },
          ];
        })
      : [];

    const markers = [...entryMarkers, ...waveMarkers];
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    this._seriesMarkersPlugin.setMarkers(markers);
  }

  private _onCrosshairMove(param: {
    time?: Time;
    point?: { x: number; y: number };
  }): void {
    if (!this._enabled || !param.time || !param.point) {
      this._hideTooltip();
      return;
    }

    const signal = this._signalsByTime.get(param.time as number);
    if (!signal?.debug) {
      this._hideTooltip();
      return;
    }

    this._showSignalTooltip(signal, param.point.x, param.point.y);
  }

  private _showSignalTooltip(signal: SonicRSignal, localX: number, localY: number): void {
    if (!signal.debug) return;
    const d = signal.debug;
    const check = (ok: boolean) => (ok ? '[OK]' : '[X]');
    const isBuy = signal.side === 'buy';
    const slopeRule = isBuy ? d.slope > 0 : d.slope < 0;
    const trendRule = isBuy ? d.close > d.ema89 : d.close < d.ema89;
    const breakRule = isBuy ? d.close >= d.leg1Price : d.close <= d.leg1Price;
    const title = isBuy ? 'BUY Conditions' : 'SELL Conditions';
    const slopeText = isBuy ? 'Dragon slope > 0' : 'Dragon slope < 0';
    const trendText = isBuy
      ? `Trend close > EMA89: ${d.close.toFixed(2)} > ${d.ema89.toFixed(2)}`
      : `Trend close < EMA89: ${d.close.toFixed(2)} < ${d.ema89.toFixed(2)}`;
    const breakText = isBuy
      ? `Break close >= leg1End: ${d.close.toFixed(2)} >= ${d.leg1Price.toFixed(2)}`
      : `Break close <= leg1End: ${d.close.toFixed(2)} <= ${d.leg1Price.toFixed(2)}`;

    this._tooltipEl.textContent = [
      title,
      `${check(slopeRule)} ${slopeText}: ${d.slope.toFixed(4)}`,
      `${check(d.slopeStrength >= d.minSlopeStrength)} Min slope strength: ${(d.slopeStrength * 100).toFixed(4)}% (min ${(d.minSlopeStrength * 100).toFixed(4)}%)`,
      `${check(d.emaSeparation >= d.minEmaSeparation)} No-chop separation: ${(d.emaSeparation * 100).toFixed(4)}% (min ${(d.minEmaSeparation * 100).toFixed(4)}%)`,
      `${check(trendRule)} ${trendText}`,
      `${check(breakRule)} ${breakText}`,
    ].join('\n');

    const rect = this._chartContainer.getBoundingClientRect();
    const x = rect.left + localX + 14;
    const y = rect.top + localY - 8;
    this._tooltipEl.style.left = `${Math.round(x)}px`;
    this._tooltipEl.style.top = `${Math.round(y)}px`;
    this._tooltipEl.style.display = 'block';
  }

  private _hideTooltip(): void {
    this._tooltipEl.style.display = 'none';
  }
}

