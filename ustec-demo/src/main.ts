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
  const replayPlayBtn = document.getElementById('replay-play') as HTMLButtonElement | null;
  const replayStepBtn = document.getElementById('replay-step') as HTMLButtonElement | null;
  const replaySpeedSelect = document.getElementById('replay-speed') as HTMLSelectElement | null;
  const replayPositionSlider = document.getElementById('replay-position') as HTMLInputElement | null;
  if (!replayPlayBtn || !replayStepBtn || !replaySpeedSelect || !replayPositionSlider) {
    throw new Error('Missing replay controls');
  }
  const replayPlayButton = replayPlayBtn;
  const replayStepButton = replayStepBtn;
  const replaySpeedInput = replaySpeedSelect;
  const replayPositionInput = replayPositionSlider;

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
  let replayCursorIndex = 0;
  let replaySpeed = Number(replaySpeedInput.value) || 5;
  let replayTimer: number | null = null;

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

  function updateReplaySliderFromTime() {
    const maxIndex = Math.max(0, data1m.length - 1);
    const ratio = maxIndex === 0 ? 0 : replayCursorIndex / maxIndex;
    replayPositionInput.value = String(Math.max(0, Math.min(1000, Math.round(ratio * 1000))));
  }

  function setReplayTimeFromSlider() {
    const slider = Number(replayPositionInput.value);
    const ratio = Math.max(0, Math.min(1, slider / 1000));
    const maxIndex = Math.max(0, data1m.length - 1);
    const nextIndex = Math.round(maxIndex * ratio);
    replayCursorIndex = Math.max(0, Math.min(maxIndex, nextIndex));
  }

  function renderCurrentFrame(intervalSeconds: number, fitContent = false) {
    const resampled = resampledByInterval.get(intervalSeconds);
    if (!resampled) return;

    const replayCurrentTime = getReplayCurrentTime();
    const visibleCount = findVisibleCount(resampled, replayCurrentTime);
    const visibleCandles = resampled.slice(0, visibleCount);
    candleSeries.setData(visibleCandles);
    currentIntervalSeconds = intervalSeconds;

    // Rebuild NY session boxes so the x/y mapping matches the new candles.
    const pane = chart.panes()[0];
    if (nyBoxesPrimitive) pane.detachPrimitive(nyBoxesPrimitive);

    nyBoxesPrimitive = createNYSessionBoxesPrimitiveFromData(
      visibleCandles as { time: number; low: number; high: number }[]
    );
    pane.attachPrimitive(nyBoxesPrimitive);

    // Update overlays for enabled indicators (Sonic R, etc.)
    indicatorManager.onReplayFrame(intervalSeconds, replayCurrentTime);

    if (fitContent) {
      requestAnimationFrame(() => chart.timeScale().fitContent());
    }
  }

  function stopReplay() {
    if (replayTimer != null) {
      window.clearInterval(replayTimer);
      replayTimer = null;
    }
    replayPlayButton.textContent = 'Play';
  }

  function stepReplay() {
    replayCursorIndex = Math.min(replayCursorIndex + 1, data1m.length - 1);
    updateReplaySliderFromTime();
    renderCurrentFrame(currentIntervalSeconds, false);
    if (replayCursorIndex >= data1m.length - 1) {
      stopReplay();
    }
  }

  function startReplay() {
    stopReplay();
    replayTimer = window.setInterval(() => {
      for (let i = 0; i < replaySpeed; i++) {
        stepReplay();
        if (replayCursorIndex >= data1m.length - 1) break;
      }
    }, 250);
    replayPlayButton.textContent = 'Pause';
  }

  // Initial load based on dropdown.
  updateReplaySliderFromTime();
  renderCurrentFrame(currentIntervalSeconds, true);

  timeframeSelect.addEventListener('change', () => {
    const nextSeconds = Number(timeframeSelect.value);
    renderCurrentFrame(nextSeconds, true);
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
    if (replayTimer == null) startReplay();
    else stopReplay();
  });
  replayStepButton.addEventListener('click', () => {
    stopReplay();
    stepReplay();
  });
  replaySpeedInput.addEventListener('change', () => {
    replaySpeed = Math.max(1, Number(replaySpeedInput.value) || 1);
    if (replayTimer != null) startReplay();
  });
  replayPositionInput.addEventListener('input', () => {
    stopReplay();
    setReplayTimeFromSlider();
    renderCurrentFrame(currentIntervalSeconds, false);
  });

  console.log(`Loaded ${data1m.length} 1m candles`);
}

main().catch(console.error);
