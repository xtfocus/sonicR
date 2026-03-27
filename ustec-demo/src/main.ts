import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import {
  createNYSessionBoxesPrimitiveFromData,
  NYSessionBoxesPrimitive,
} from './session-boxes-primitive';
import { computeSonicRFromCandles } from './sonic-r-ema';
import type { SonicRComputed } from './sonic-r-ema';
import { indicatorDefinitions } from './indicators/registry';
import { IndicatorManager } from './indicators/indicator-manager';
import { SonicRIndicator } from './indicators/sonicR-indicator';
import { computeSonicRWavePatterns, type WavePattern } from './sonic-r-wave';
import { computeSonicREntries, type SonicRSignal } from './sonic-r-entry';

// ============================================
// 1. CREATE THE CHART (from getting-started ideas)
// ============================================

const chartContainer = document.getElementById('chart');
if (!chartContainer) throw new Error('Missing #chart container');

const chart = createChart(chartContainer, {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: '#131722' },
    textColor: '#d1d4dc',
  },
  grid: {
    vertLines: { color: '#1f2943' },
    horzLines: { color: '#1f2943' },
  },
  crosshair: {
    mode: 0,
    vertLine: { color: '#758696', labelBackgroundColor: '#4c525e' },
    horzLine: { color: '#758696', labelBackgroundColor: '#4c525e' },
  },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 10,
  },
});

// ============================================
// 2. ADD CANDLESTICK SERIES
// ============================================

const candleSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderUpColor: '#26a69a',
  borderDownColor: '#ef5350',
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
});

// ============================================
// 3. PARSE USTEC CSV (tab-separated OHLC)
// Columns: <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>
// Date format: 2025.08.01, Time: 00:00:00
// ============================================

function parseDateToUtcSeconds(dateStr: string, timeStr: string): number {
  // dateStr = "2025.08.01" -> y, m, d
  const [y, m, d] = dateStr.split('.').map(Number);
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  return Math.floor(ms / 1000) as UTCTimestamp;
}

async function loadUstecCsv(): Promise<CandlestickData[]> {
  const url = '/data/USTEC_M1_202508010000_202603031408.csv';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load CSV: ${response.statusText}`);
  const text = await response.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const rows: CandlestickData[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 6) continue;
    const [date, time, open, high, low, close] = cols;
    rows.push({
      time: parseDateToUtcSeconds(date, time) as UTCTimestamp,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
    });
  }
  return rows;
}

function resampleOhlcSkipEmptyBuckets(
  data1m: CandlestickData[],
  intervalSeconds: number
): CandlestickData[] {
  // lightweight-charts expects `time` to be increasing. We keep only buckets that
  // have at least one underlying 1m candle (skip empty buckets).
  if (intervalSeconds <= 60) return data1m;

  const buckets = new Map<number, CandlestickData[]>();

  for (const c of data1m) {
    const t = c.time as number;
    const bucketStart = Math.floor(t / intervalSeconds) * intervalSeconds;
    const arr = buckets.get(bucketStart);
    if (arr) arr.push(c);
    else buckets.set(bucketStart, [c]);
  }

  const bucketStarts = Array.from(buckets.keys()).sort((a, b) => a - b);
  const result: CandlestickData[] = [];

  for (const bucketStart of bucketStarts) {
    const arr = buckets.get(bucketStart)!;
    // assumes input is ordered; if it's not, you'd need to sort `arr` by time here.
    const open = arr[0].open!;
    const close = arr[arr.length - 1].close!;
    let high = -Infinity;
    let low = Infinity;

    for (const x of arr) {
      high = Math.max(high, x.high!);
      low = Math.min(low, x.low!);
    }

    result.push({
      time: bucketStart as UTCTimestamp,
      open,
      high,
      low,
      close,
    });
  }

  return result;
}

// ============================================
// 4. INITIALIZE
// ============================================

async function main() {
  console.log('Loading USTEC M1 data...');
  const data1m = await loadUstecCsv();
  if (data1m.length === 0) {
    console.error('No data loaded');
    return;
  }

  const timeframeSelect = document.getElementById('timeframe') as HTMLSelectElement | null;
  if (!timeframeSelect) throw new Error('Missing #timeframe select');
  const replayModeToggleBtn = document.getElementById('replay-mode-toggle') as HTMLButtonElement | null;
  const replayPlayBtn = document.getElementById('replay-play') as HTMLButtonElement | null;
  const replayStepBtn = document.getElementById('replay-step') as HTMLButtonElement | null;
  const replaySpeedSelect = document.getElementById('replay-speed') as HTMLSelectElement | null;
  const replayPositionSlider = document.getElementById('replay-position') as HTMLInputElement | null;
  const replayJumpDatetimeInput = document.getElementById('replay-jump-datetime') as HTMLInputElement | null;
  const replayControlsWrap = document.getElementById('replay-controls') as HTMLDivElement | null;
  if (
    !replayModeToggleBtn ||
    !replayPlayBtn ||
    !replayStepBtn ||
    !replaySpeedSelect ||
    !replayPositionSlider ||
    !replayJumpDatetimeInput ||
    !replayControlsWrap
  ) {
    throw new Error('Missing replay controls');
  }
  const replayModeToggleButton = replayModeToggleBtn;
  const replayPlayButton = replayPlayBtn;
  const replayStepButton = replayStepBtn;
  const replaySpeedInput = replaySpeedSelect;
  const replayPositionInput = replayPositionSlider;
  const replayJumpDatetime = replayJumpDatetimeInput;
  const replayControls = replayControlsWrap;

  // Cache resampled candles so switching timeframes is instant.
  const timeframesSeconds = [60, 300, 900, 1800, 3600, 86400];
  const resampledByInterval = new Map<number, CandlestickData[]>();
  for (const seconds of timeframesSeconds) {
    resampledByInterval.set(
      seconds,
      resampleOhlcSkipEmptyBuckets(data1m, seconds)
    );
  }

  // Precompute Sonic R for all timeframes, so enabling/disabling is instant.
  const sonicRByIntervalSeconds = new Map<number, SonicRComputed>();
  const entriesByIntervalSeconds = new Map<number, SonicRSignal[]>();
  const wavesByIntervalSeconds = new Map<number, WavePattern[]>();
  const pivotRightBarsByIntervalSeconds = new Map<number, number>();
  for (const seconds of timeframesSeconds) {
    const candles = resampledByInterval.get(seconds);
    if (!candles) continue;

    const sonic = computeSonicRFromCandles(candles);
    sonicRByIntervalSeconds.set(seconds, sonic);

    // Pivot size in bars should roughly map to ~15 minutes on each side.
    const pivotBars = Math.max(2, Math.round((15 * 60) / seconds));
    pivotRightBarsByIntervalSeconds.set(seconds, pivotBars);
    const waves = computeSonicRWavePatterns(candles, pivotBars, pivotBars);
    wavesByIntervalSeconds.set(seconds, waves);

    const entries = computeSonicREntries(candles, sonic, waves);
    entriesByIntervalSeconds.set(seconds, entries);
  }

  const sonicRIndicator = new SonicRIndicator(
    chart,
    candleSeries,
    sonicRByIntervalSeconds,
    entriesByIntervalSeconds,
    wavesByIntervalSeconds,
    resampledByInterval,
    pivotRightBarsByIntervalSeconds,
    chartContainer!
  );
  const indicatorManager = new IndicatorManager([sonicRIndicator]);

  let nyBoxesPrimitive: NYSessionBoxesPrimitive | null = null;
  let currentIntervalSeconds = Number(timeframeSelect.value);
  let isReplayMode = false;
  let replayCursorIndex = 0;
  let replaySpeed = Number(replaySpeedInput.value) || 5;
  let replayTimer: number | null = null;
  let lastReplayRenderedInterval: number | null = null;
  let lastReplayRenderedVisibleCount = 0;

  function getReplayCurrentTime(): UTCTimestamp {
    return data1m[replayCursorIndex]!.time as UTCTimestamp;
  }

  function findVisibleCount(candles: CandlestickData[], currentTime: UTCTimestamp): number {
    const target = currentTime as number;
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = candles[mid]!.time as number;
      if (t <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function findIndexAtOrBeforeTime(targetTimeSec: number): number {
    let lo = 0;
    let hi = data1m.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = data1m[mid]!.time as number;
      if (t <= targetTimeSec) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  function formatJumpDateTime(sec: number): string {
    const d = new Date(sec * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function parseJumpDateTime(value: string): number | null {
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;

    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    if (
      !Number.isInteger(day) ||
      !Number.isInteger(month) ||
      !Number.isInteger(year) ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute)
    ) {
      return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day ||
      dt.getHours() !== hour ||
      dt.getMinutes() !== minute
    ) {
      return null;
    }
    return Math.floor(dt.getTime() / 1000);
  }

  function syncJumpInputFromCursor() {
    const currentSec = data1m[replayCursorIndex]!.time as number;
    replayJumpDatetime.value = formatJumpDateTime(currentSec);
  }

  function updateReplaySliderFromTime() {
    const maxIndex = Math.max(0, data1m.length - 1);
    const ratio = maxIndex === 0 ? 0 : replayCursorIndex / maxIndex;
    replayPositionInput.value = String(Math.max(0, Math.min(1000, Math.round(ratio * 1000))));
    syncJumpInputFromCursor();
  }

  function setReplayTimeFromSlider() {
    const slider = Number(replayPositionInput.value);
    const ratio = Math.max(0, Math.min(1, slider / 1000));
    const maxIndex = Math.max(0, data1m.length - 1);
    const nextIndex = Math.round(maxIndex * ratio);
    replayCursorIndex = Math.max(0, Math.min(maxIndex, nextIndex));
  }

  function rebuildNyBoxes(visibleCandles: CandlestickData[]) {
    const pane = chart.panes()[0];
    if (nyBoxesPrimitive) pane.detachPrimitive(nyBoxesPrimitive);
    nyBoxesPrimitive = createNYSessionBoxesPrimitiveFromData(
      visibleCandles as { time: number; low: number; high: number }[]
    );
    pane.attachPrimitive(nyBoxesPrimitive);
  }

  function renderCurrentFrame(intervalSeconds: number, fitContent = false, force = false) {
    const resampled = resampledByInterval.get(intervalSeconds);
    if (!resampled) return;

    const replayCurrentTime = getReplayCurrentTime();
    const visibleCount = findVisibleCount(resampled, replayCurrentTime);
    const visibleCandles = resampled.slice(0, visibleCount);

    const sameInterval = lastReplayRenderedInterval === intervalSeconds;
    const forwardIncremental =
      sameInterval &&
      !force &&
      visibleCount >= lastReplayRenderedVisibleCount &&
      visibleCount - lastReplayRenderedVisibleCount <= 16;

    // If replay source advanced but this timeframe has no new bar yet (e.g. 5m while stepping 1m),
    // skip heavy redraw work.
    if (!force && sameInterval && visibleCount === lastReplayRenderedVisibleCount) {
      return;
    }

    if (forwardIncremental) {
      for (let i = lastReplayRenderedVisibleCount; i < visibleCount; i++) {
        const next = resampled[i];
        if (next) candleSeries.update(next);
      }
    } else {
      candleSeries.setData(visibleCandles);
    }
    currentIntervalSeconds = intervalSeconds;
    lastReplayRenderedInterval = intervalSeconds;
    lastReplayRenderedVisibleCount = visibleCount;

    rebuildNyBoxes(visibleCandles);
    indicatorManager.onReplayFrame(intervalSeconds, replayCurrentTime);

    if (fitContent) {
      requestAnimationFrame(() => chart.timeScale().fitContent());
    }
  }

  function renderFullFrame(intervalSeconds: number, fitContent = false) {
    const resampled = resampledByInterval.get(intervalSeconds);
    if (!resampled) return;

    candleSeries.setData(resampled);
    currentIntervalSeconds = intervalSeconds;

    rebuildNyBoxes(resampled);

    indicatorManager.onTimeframeChanged(intervalSeconds);
    if (fitContent) {
      requestAnimationFrame(() => chart.timeScale().fitContent());
    }
  }

  function renderView(intervalSeconds: number, fitContent = false) {
    if (isReplayMode) renderCurrentFrame(intervalSeconds, fitContent);
    else renderFullFrame(intervalSeconds, fitContent);
  }

  function stopReplay(syncUi = true) {
    if (replayTimer != null) {
      window.clearTimeout(replayTimer);
      replayTimer = null;
    }
    if (syncUi) updateReplaySliderFromTime();
    replayPlayButton.textContent = 'Play';
  }

  function stepReplay(shouldSyncUi = true) {
    if (!isReplayMode) return;
    replayCursorIndex = Math.min(replayCursorIndex + 1, data1m.length - 1);
    if (shouldSyncUi) updateReplaySliderFromTime();
    renderCurrentFrame(currentIntervalSeconds, false);
    if (replayCursorIndex >= data1m.length - 1) {
      stopReplay();
    }
  }

  function startReplay() {
    if (!isReplayMode) return;
    stopReplay();
    focusReplayCursor();
    const stepDelayMs = Math.max(16, Math.round(1000 / Math.max(1, replaySpeed)));
    const tick = () => {
      if (!isReplayMode || replayTimer == null) return;
      stepReplay(true);
      if (replayCursorIndex >= data1m.length - 1) {
        stopReplay();
        return;
      }
      replayTimer = window.setTimeout(tick, stepDelayMs);
    };
    replayTimer = window.setTimeout(tick, stepDelayMs);
    replayPlayButton.textContent = 'Pause';
  }

  function stepReplayOneBarCurrentTimeframe() {
    const resampled = resampledByInterval.get(currentIntervalSeconds);
    if (!resampled || resampled.length === 0) return;

    const replayCurrentTime = getReplayCurrentTime();
    const visibleCount = findVisibleCount(resampled, replayCurrentTime);
    if (visibleCount >= resampled.length) {
      stopReplay();
      return;
    }

    const nextBar = resampled[visibleCount];
    if (!nextBar) return;
    replayCursorIndex = findIndexAtOrBeforeTime(nextBar.time as number);
    updateReplaySliderFromTime();
    renderCurrentFrame(currentIntervalSeconds, false, true);
  }

  function focusReplayCursor() {
    const resampled = resampledByInterval.get(currentIntervalSeconds);
    if (!resampled || resampled.length === 0) return;

    const replayCurrentTime = getReplayCurrentTime();
    const visibleCount = findVisibleCount(resampled, replayCurrentTime);
    const currentIndex = Math.max(0, visibleCount - 1);
    const lookbackBars = 120;
    const fromIndex = Math.max(0, currentIndex - lookbackBars);
    const from = resampled[fromIndex]?.time as UTCTimestamp | undefined;
    const to = resampled[currentIndex]?.time as UTCTimestamp | undefined;
    if (from == null || to == null) return;

    chart.timeScale().setVisibleRange({ from, to });
  }

  function setReplayControlsEnabled(enabled: boolean) {
    replayPlayButton.disabled = !enabled;
    replayStepButton.disabled = !enabled;
    replaySpeedInput.disabled = !enabled;
    replayPositionInput.disabled = !enabled;
    replayJumpDatetime.disabled = !enabled;
    replayControls.style.opacity = enabled ? '1' : '0.6';
  }

  function enterReplayMode() {
    isReplayMode = true;
    replayModeToggleButton.textContent = 'Exit Replay';
    setReplayControlsEnabled(true);
    updateReplaySliderFromTime();
    lastReplayRenderedInterval = null;
    lastReplayRenderedVisibleCount = 0;
    renderCurrentFrame(currentIntervalSeconds, true, true);
  }

  function exitReplayMode() {
    stopReplay();
    isReplayMode = false;
    replayModeToggleButton.textContent = 'Enter Replay';
    setReplayControlsEnabled(false);
    lastReplayRenderedInterval = null;
    lastReplayRenderedVisibleCount = 0;
    renderFullFrame(currentIntervalSeconds, true);
  }

  // Initial load based on dropdown.
  updateReplaySliderFromTime();
  setReplayControlsEnabled(false);
  renderView(currentIntervalSeconds, true);

  timeframeSelect.addEventListener('change', () => {
    const nextSeconds = Number(timeframeSelect.value);
    renderView(nextSeconds, true);
  });

  // Build extensible indicator toggle menu (TradingView-like).
  const indicatorsMenu = document.getElementById('indicators-menu');
  if (!indicatorsMenu) throw new Error('Missing #indicators-menu container');

  indicatorsMenu.innerHTML = '';
  for (const def of indicatorDefinitions) {
    const id = `toggle-${def.id}`;

    const label = document.createElement('label');
    label.style.display = 'block';
    label.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.checked = def.defaultEnabled;
    checkbox.style.marginRight = '8px';

    checkbox.addEventListener('change', () => {
      indicatorManager.setEnabled(def.id, checkbox.checked);
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(def.label));

    indicatorsMenu.appendChild(label);

    if (def.id === 'sonicR') {
      const waveWrap = document.createElement('div');
      waveWrap.style.margin = '2px 0 0 22px';

      const waveLabel = document.createElement('label');
      waveLabel.style.display = 'inline-flex';
      waveLabel.style.alignItems = 'center';
      waveLabel.style.cursor = 'pointer';
      waveLabel.style.opacity = '0.9';

      const waveCheckbox = document.createElement('input');
      waveCheckbox.type = 'checkbox';
      waveCheckbox.id = 'toggle-sonicR-waves';
      waveCheckbox.checked = true;
      waveCheckbox.style.marginRight = '8px';
      waveCheckbox.addEventListener('change', () => {
        sonicRIndicator.setShowWaves(waveCheckbox.checked);
      });

      waveLabel.appendChild(waveCheckbox);
      waveLabel.appendChild(document.createTextNode('Show waves/legs'));
      waveWrap.appendChild(waveLabel);
      indicatorsMenu.appendChild(waveWrap);
    }
  }

  // Apply default enabled/disabled state after menu build.
  for (const def of indicatorDefinitions) {
    const el = document.getElementById(`toggle-${def.id}`) as HTMLInputElement | null;
    if (!el) continue;
    indicatorManager.setEnabled(def.id, el.checked);
  }

  replayPlayButton.addEventListener('click', () => {
    if (!isReplayMode) return;
    if (replayTimer == null) startReplay();
    else stopReplay();
  });
  replayStepButton.addEventListener('click', () => {
    if (!isReplayMode) return;
    stopReplay();
    stepReplayOneBarCurrentTimeframe();
  });
  replaySpeedInput.addEventListener('change', () => {
    if (!isReplayMode) return;
    replaySpeed = Math.max(1, Number(replaySpeedInput.value) || 1);
    if (replayTimer != null) startReplay();
  });
  replayPositionInput.addEventListener('input', () => {
    if (!isReplayMode) return;
    stopReplay(false);
    setReplayTimeFromSlider();
    syncJumpInputFromCursor();
    renderCurrentFrame(currentIntervalSeconds, false, true);
  });
  replayModeToggleButton.addEventListener('click', () => {
    if (isReplayMode) exitReplayMode();
    else enterReplayMode();
  });
  replayJumpDatetime.addEventListener('change', () => {
    if (!isReplayMode) return;
    const value = replayJumpDatetime.value;
    if (!value) return;
    const sec = parseJumpDateTime(value);
    if (sec == null) {
      syncJumpInputFromCursor();
      return;
    }
    replayCursorIndex = findIndexAtOrBeforeTime(sec);
    stopReplay();
    updateReplaySliderFromTime();
    renderCurrentFrame(currentIntervalSeconds, false, true);
  });

  console.log(`Loaded ${data1m.length} 1m candles`);
}

main().catch(console.error);
