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
import { OrderBlocksPrimitive } from '../order-blocks-primitive';
import type { SonicRSignal } from '../sonic-r-entry';
import type { WavePattern } from '../sonic-r-wave';
import { SonicRWavesPrimitive } from '../sonic-r-waves-primitive';
import { computeLuxAlgoOrderBlocks, type OhlcvBar } from '../sonic-r-order-blocks';
import type { IndicatorController } from './types';

const DRAGON_LINE_COLOR = 'rgba(41, 98, 255, 0.55)';
const DRAGON_CENTER_COLOR = 'rgba(41, 98, 255, 0.95)';
const EMA89_COLOR = 'rgba(239, 83, 80, 0.95)';

export class SonicRIndicator implements IndicatorController {
  readonly id = 'sonicR';

  private _enabled = false;
  private _showWaves = true;
  private _showOrderBlocks = false;
  private _lastIntervalSeconds = 60;
  private _lastReplayTime: UTCTimestamp | null = null;
  private _lastWindowStartTime: UTCTimestamp | null = null;
  private _lastRenderedIntervalSeconds: number | null = null;
  private _lastRenderedReplayTime: UTCTimestamp | null = null;
  private _lastRenderedWindowStartTime: UTCTimestamp | null = null;

  private _emaLow34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _emaHigh34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _emaClose34Series!: ReturnType<IChartApiBase<Time>['addSeries']>;
  private _ema89Series!: ReturnType<IChartApiBase<Time>['addSeries']>;

  private _dragonFillPrimitive: DragonFillPrimitive | null = null;
  private _wavesPrimitive: SonicRWavesPrimitive | null = null;
  private _orderBlocksPrimitive: OrderBlocksPrimitive | null = null;
  private _seriesMarkersPlugin!: ISeriesMarkersPluginApi<Time>;
  private _signalsByTime = new Map<number, SonicRSignal>();
  private _tooltipEl: HTMLDivElement;
  private _copiedBadgeEl: HTMLDivElement;
  private _copiedBadgeTimer: number | null = null;
  private _lastTooltipText: string | null = null;

  constructor(
    private _chart: IChartApiBase<Time>,
    private _candleSeries: ISeriesApi<'Candlestick', Time>,
    private _sonicRByIntervalSeconds: Map<number, SonicRComputed>,
    private _entriesByIntervalSeconds: Map<number, SonicRSignal[]>,
    private _wavesByIntervalSeconds: Map<number, WavePattern[]>,
    private _candlesByIntervalSeconds: Map<number, OhlcvBar[]>,
    private _pivotRightBarsByIntervalSeconds: Map<number, number>,
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
    this._tooltipEl.style.fontSize = '16px';
    this._tooltipEl.style.lineHeight = '1.4';
    this._tooltipEl.style.whiteSpace = 'pre-line';
    this._tooltipEl.style.display = 'none';
    document.body.appendChild(this._tooltipEl);

    this._copiedBadgeEl = document.createElement('div');
    this._copiedBadgeEl.style.position = 'absolute';
    this._copiedBadgeEl.style.zIndex = '21';
    this._copiedBadgeEl.style.pointerEvents = 'none';
    this._copiedBadgeEl.style.background = 'rgba(34, 197, 94, 0.95)';
    this._copiedBadgeEl.style.color = '#0b1020';
    this._copiedBadgeEl.style.borderRadius = '999px';
    this._copiedBadgeEl.style.padding = '3px 8px';
    this._copiedBadgeEl.style.fontSize = '12px';
    this._copiedBadgeEl.style.fontWeight = '600';
    this._copiedBadgeEl.style.display = 'none';
    this._copiedBadgeEl.textContent = 'Copied';
    document.body.appendChild(this._copiedBadgeEl);

    this._chart.subscribeCrosshairMove((param: any) => {
      this._onCrosshairMove(param);
    });
    this._chart.subscribeClick((param: any) => {
      this._onChartClick(param);
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
      if (pane && this._orderBlocksPrimitive) pane.detachPrimitive(this._orderBlocksPrimitive);
      this._orderBlocksPrimitive = null;
      this._signalsByTime.clear();
      this._hideTooltip();

      this._seriesMarkersPlugin.setMarkers([]);
      this._lastRenderedIntervalSeconds = null;
      this._lastRenderedReplayTime = null;
      this._lastRenderedWindowStartTime = null;
      return;
    }

    this._lastRenderedIntervalSeconds = null;
    this._lastRenderedReplayTime = null;
    this._lastRenderedWindowStartTime = null;
    this.onReplayFrame(this._lastIntervalSeconds, this._lastReplayTime, this._lastWindowStartTime);
  }

  setShowWaves(showWaves: boolean): void {
    this._showWaves = showWaves;
    if (this._enabled) {
      // Force a redraw even if replay time/interval didn't change.
      this._lastRenderedIntervalSeconds = null;
      this._lastRenderedReplayTime = null;
      this._lastRenderedWindowStartTime = null;
      this.onReplayFrame(this._lastIntervalSeconds, this._lastReplayTime, this._lastWindowStartTime);
    }
  }

  setShowOrderBlocks(showOrderBlocks: boolean): void {
    this._showOrderBlocks = showOrderBlocks;
    if (this._enabled) {
      this._lastRenderedIntervalSeconds = null;
      this._lastRenderedReplayTime = null;
      this._lastRenderedWindowStartTime = null;
      this.onReplayFrame(this._lastIntervalSeconds, this._lastReplayTime, this._lastWindowStartTime);
    }
  }

  onTimeframe(intervalSeconds: number): void {
    this._lastIntervalSeconds = intervalSeconds;
    this.onReplayFrame(intervalSeconds, null, null);
  }

  onReplayFrame(
    intervalSeconds: number,
    currentTime: UTCTimestamp | null,
    windowStartTime: UTCTimestamp | null
  ): void {
    this._lastIntervalSeconds = intervalSeconds;
    this._lastReplayTime = currentTime;
    this._lastWindowStartTime = windowStartTime;
    if (!this._enabled) return;
    if (
      this._lastRenderedIntervalSeconds === intervalSeconds &&
      (this._lastRenderedReplayTime as number | null) === (currentTime as number | null) &&
      (this._lastRenderedWindowStartTime as number | null) === (windowStartTime as number | null)
    ) {
      return;
    }

    const computed = this._sonicRByIntervalSeconds.get(intervalSeconds);
    if (!computed) return;

    const pane = this._chart.panes()[0];

    const emaLow34 = this._sliceByTimeRange(computed.emaLow34, windowStartTime, currentTime);
    const emaHigh34 = this._sliceByTimeRange(computed.emaHigh34, windowStartTime, currentTime);
    const emaClose34 = this._sliceByTimeRange(computed.emaClose34, windowStartTime, currentTime);
    const ema89 = this._sliceByTimeRange(computed.ema89, windowStartTime, currentTime);
    const dragonFillPoints = this._sliceByTimeRange(computed.dragonFillPoints, windowStartTime, currentTime);

    this._emaLow34Series.setData(emaLow34 as any);
    this._emaHigh34Series.setData(emaHigh34 as any);
    this._emaClose34Series.setData(emaClose34 as any);
    this._ema89Series.setData(ema89 as any);

    if (this._dragonFillPrimitive) pane.detachPrimitive(this._dragonFillPrimitive);
    this._dragonFillPrimitive = new DragonFillPrimitive(dragonFillPoints);
    pane.attachPrimitive(this._dragonFillPrimitive);

    if (this._wavesPrimitive) pane.detachPrimitive(this._wavesPrimitive);
    this._wavesPrimitive = null;
    const waves = this._visibleWaves(intervalSeconds, currentTime, windowStartTime);
    if (this._showWaves) {
      this._wavesPrimitive = new SonicRWavesPrimitive(waves);
      pane.attachPrimitive(this._wavesPrimitive);
    }

    if (this._orderBlocksPrimitive) pane.detachPrimitive(this._orderBlocksPrimitive);
    this._orderBlocksPrimitive = null;
    if (this._showOrderBlocks) {
      const allCandles = this._candlesByIntervalSeconds.get(intervalSeconds) ?? [];
      const endIndex = this._endBarIndexAtOrBeforeTime(allCandles, currentTime);
      const { bull, bear } = computeLuxAlgoOrderBlocks(allCandles, endIndex);
      const combined = [...bull, ...bear].sort(
        (a, b) => (a.leftTime as number) - (b.leftTime as number)
      );
      this._orderBlocksPrimitive = new OrderBlocksPrimitive(combined);
      pane.attachPrimitive(this._orderBlocksPrimitive);
    }

    // Render setup markers (WAIT FOR BUY/SELL) and optional wave leg labels.
    const entries = this._visibleEntries(intervalSeconds, currentTime, windowStartTime, waves);
    this._signalsByTime = new Map(entries.map((s) => [s.time as number, s]));
    const entryMarkers = entries.map((s) => {
      const isBuy = s.side === 'buy';
      return {
        time: s.time as UTCTimestamp,
        position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
        shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
        color: isBuy ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 83, 80, 0.95)',
        text: isBuy ? 'WAIT FOR BUY' : 'WAIT FOR SELL',
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
    this._lastRenderedIntervalSeconds = intervalSeconds;
    this._lastRenderedReplayTime = currentTime;
    this._lastRenderedWindowStartTime = windowStartTime;
  }

  private _endBarIndexAtOrBeforeTime(candles: OhlcvBar[], currentTime: UTCTimestamp | null): number {
    if (candles.length === 0) return -1;
    if (currentTime == null) return candles.length - 1;
    const t = currentTime as number;
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((candles[mid]!.time as number) <= t) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  private _sliceByTimeRange<T extends { time: UTCTimestamp }>(
    values: T[],
    windowStartTime: UTCTimestamp | null,
    currentTime: UTCTimestamp | null
  ): T[] {
    if (currentTime == null) return values;
    const start = windowStartTime == null ? Number.NEGATIVE_INFINITY : (windowStartTime as number);
    const end = currentTime as number;
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[mid]!.time as number) < start) lo = mid + 1;
      else hi = mid;
    }
    const from = lo;
    lo = from;
    hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[mid]!.time as number) <= end) lo = mid + 1;
      else hi = mid;
    }
    return values.slice(from, lo);
  }

  private _visibleWaves(
    intervalSeconds: number,
    currentTime: UTCTimestamp | null,
    windowStartTime: UTCTimestamp | null
  ): WavePattern[] {
    const waves = this._wavesByIntervalSeconds.get(intervalSeconds) ?? [];
    if (currentTime == null) return waves;

    const candles = this._candlesByIntervalSeconds.get(intervalSeconds) ?? [];
    const rightBars = this._pivotRightBarsByIntervalSeconds.get(intervalSeconds) ?? 2;
    const current = currentTime as number;
    const start = windowStartTime == null ? Number.NEGATIVE_INFINITY : (windowStartTime as number);
    return waves.filter((w) => {
      const confirmationIndex = w.leg3End.index + rightBars;
      const confirmationCandle = candles[confirmationIndex];
      if (!confirmationCandle) return false;
      if ((confirmationCandle.time as number) > current) return false;
      return (w.leg3End.time as number) >= start;
    });
  }

  private _visibleEntries(
    intervalSeconds: number,
    currentTime: UTCTimestamp | null,
    windowStartTime: UTCTimestamp | null,
    visibleWaves: WavePattern[]
  ): SonicRSignal[] {
    const entries = this._entriesByIntervalSeconds.get(intervalSeconds) ?? [];
    if (currentTime == null) return entries;

    const visibleWaveSet = new Set(visibleWaves);
    const waves = this._wavesByIntervalSeconds.get(intervalSeconds) ?? [];
    const current = currentTime as number;
    const start = windowStartTime == null ? Number.NEGATIVE_INFINITY : (windowStartTime as number);

    return entries.filter((entry) => {
      if ((entry.time as number) > current) return false;
      if ((entry.time as number) < start) return false;
      const ownerWave = waves.find((w) => {
        const start = w.leg2End.time as number;
        const end = w.leg3End.time as number;
        const t = entry.time as number;
        return t >= start && t <= end && (entry.side === 'buy' ? w.direction === 'bull' : w.direction === 'bear');
      });
      if (!ownerWave) return true;
      return visibleWaveSet.has(ownerWave);
    });
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
    const tooltipText = this._buildSignalTooltipText(signal);
    this._tooltipEl.textContent = tooltipText;
    this._lastTooltipText = tooltipText;

    const rect = this._chartContainer.getBoundingClientRect();
    const x = rect.left + localX + 14;
    const y = rect.top + localY - 8;
    this._tooltipEl.style.left = `${Math.round(x)}px`;
    this._tooltipEl.style.top = `${Math.round(y)}px`;
    this._tooltipEl.style.display = 'block';
  }

  private _hideTooltip(): void {
    this._tooltipEl.style.display = 'none';
    this._lastTooltipText = null;
  }

  private _buildSignalTooltipText(signal: SonicRSignal): string {
    if (!signal.debug) return '';
    const d = signal.debug;
    const check = (ok: boolean) => (ok ? '[OK]' : '[X]');
    const isBuy = signal.side === 'buy';
    const slopeRule = isBuy ? d.slope > 0 : d.slope < 0;
    const trendRule = isBuy ? d.close > d.ema89 : d.close < d.ema89;
    const breakRule = isBuy ? d.close >= d.leg1Price : d.close <= d.leg1Price;
    const title = isBuy ? 'WAIT FOR BUY Setup' : 'WAIT FOR SELL Setup';
    const slopeText = isBuy ? 'Dragon slope > 0' : 'Dragon slope < 0';
    const trendText = isBuy
      ? `Trend close > EMA89: ${d.close.toFixed(2)} > ${d.ema89.toFixed(2)}`
      : `Trend close < EMA89: ${d.close.toFixed(2)} < ${d.ema89.toFixed(2)}`;
    const breakText = isBuy
      ? `Break close >= leg1End: ${d.close.toFixed(2)} >= ${d.leg1Price.toFixed(2)}`
      : `Break close <= leg1End: ${d.close.toFixed(2)} <= ${d.leg1Price.toFixed(2)}`;
    const pendingGuide = isBuy
      ? `Guide: place Buy Stop above trigger high: ${d.pendingEntryPrice.toFixed(2)} (= ${d.triggerHigh.toFixed(2)} + ${d.pendingEntryBuffer.toFixed(2)})`
      : `Guide: place Sell Stop below trigger low: ${d.pendingEntryPrice.toFixed(2)} (= ${d.triggerLow.toFixed(2)} - ${d.pendingEntryBuffer.toFixed(2)})`;

    return [
      title,
      `${check(slopeRule)} ${slopeText}: ${d.slope.toFixed(4)}`,
      `${check(d.slopeStrength >= d.minSlopeStrength)} Min slope strength: ${(d.slopeStrength * 100).toFixed(4)}% (min ${(d.minSlopeStrength * 100).toFixed(4)}%)`,
      `${check(d.emaSeparation >= d.minEmaSeparation)} No-chop separation: ${(d.emaSeparation * 100).toFixed(4)}% (min ${(d.minEmaSeparation * 100).toFixed(4)}%)`,
      `${check(trendRule)} ${trendText}`,
      `${check(breakRule)} ${breakText}`,
      pendingGuide,
    ].join('\n');
  }

  private _onChartClick(param: {
    time?: Time;
    point?: { x: number; y: number };
  }): void {
    if (!this._enabled || !param.time) return;
    const signal = this._signalsByTime.get(param.time as number);
    if (!signal?.debug) return;

    const textToCopy = this._lastTooltipText ?? this._buildSignalTooltipText(signal);
    if (!textToCopy) return;
    void navigator.clipboard.writeText(textToCopy).then(() => {
      this._showCopiedBadge(param.point);
    }).catch(() => {
      // Swallow clipboard failures (e.g. insecure context) to avoid breaking chart clicks.
    });
  }

  private _showCopiedBadge(point?: { x: number; y: number }): void {
    const rect = this._chartContainer.getBoundingClientRect();
    if (point) {
      this._copiedBadgeEl.style.left = `${Math.round(rect.left + point.x + 12)}px`;
      this._copiedBadgeEl.style.top = `${Math.round(rect.top + point.y - 24)}px`;
    } else if (this._tooltipEl.style.display === 'block') {
      this._copiedBadgeEl.style.left = this._tooltipEl.style.left;
      this._copiedBadgeEl.style.top = `${Math.round(parseInt(this._tooltipEl.style.top || '0', 10) - 26)}px`;
    } else {
      this._copiedBadgeEl.style.left = `${Math.round(rect.left + 12)}px`;
      this._copiedBadgeEl.style.top = `${Math.round(rect.top + 12)}px`;
    }
    this._copiedBadgeEl.style.display = 'block';

    if (this._copiedBadgeTimer != null) window.clearTimeout(this._copiedBadgeTimer);
    this._copiedBadgeTimer = window.setTimeout(() => {
      this._copiedBadgeEl.style.display = 'none';
      this._copiedBadgeTimer = null;
    }, 1000);
  }
}

