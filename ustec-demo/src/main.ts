import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

// ============================================
// 1. CREATE THE CHART (from getting-started ideas)
// ============================================

const chart = createChart(document.getElementById('chart')!, {
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

// ============================================
// 4. INITIALIZE
// ============================================

async function main() {
  console.log('Loading USTEC M1 data...');
  const data = await loadUstecCsv();
  if (data.length === 0) {
    console.error('No data loaded');
    return;
  }
  candleSeries.setData(data);
  chart.timeScale().fitContent();
  console.log(`Loaded ${data.length} candles`);
}

main().catch(console.error);
