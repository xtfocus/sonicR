/**
 * Data selector tool: drag a left→right range on the chart, then export the
 * selected bars of the active timeframe as an auto-named CSV download or copy
 * them as a Markdown table. A floating action popup anchors near the release
 * point (TradingView-like). Selection persists across timeframe switches and
 * replay progress; exports always slice the effective (replay-aware) dataset,
 * so what you see is what you get.
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { SelectionBandPrimitive, type SelectionRange } from './selection-band-primitive';
import type { OhlcvBar } from './sonic-r-order-blocks';
import {
  barsToCsv,
  barsToMarkdown,
  buildCsvFilename,
  copyTextToClipboard,
  downloadTextFile,
  formatBarTime,
} from './data-export';

export interface SelectionToolDeps {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  container: HTMLElement;
  symbol: string;
  /** Effective bars of the active timeframe (replay-aware), ascending by time. */
  getDataset: () => OhlcvBar[];
  /** Active timeframe label for filenames/summaries, e.g. '5m'. */
  getTimeframeLabel: () => string;
  /** True when another interaction (space-pan) owns left-drag. */
  isInterceptBlocked?: () => boolean;
  /** Notified when the tool is enabled/disabled (cursor ownership). */
  onStateChange?: () => void;
}

/** Below this horizontal movement a release counts as a click, not a drag. */
const DRAG_MIN_PX = 4;

/** First index in `bars` with time >= target. */
function lowerBoundByTime(bars: OhlcvBar[], target: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid]!.time as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in `bars` with time > target. */
function upperBoundByTime(bars: OhlcvBar[], target: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid]!.time as number) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the bar whose time is closest to `target` (bars ascending). */
function nearestIndexByTime(bars: OhlcvBar[], target: number): number {
  const upper = upperBoundByTime(bars, target);
  const before = bars[upper - 1];
  const after = bars[upper];
  if (before && after) {
    return Math.abs((before.time as number) - target) <=
      Math.abs((after.time as number) - target)
      ? upper - 1
      : upper;
  }
  return before ? upper - 1 : 0;
}

export class SelectionTool {
  private readonly _band = new SelectionBandPrimitive();
  private _enabled = false;
  private _range: SelectionRange | null = null;
  private _dragging = false;
  private _dragStartClientX = 0;
  private _dragStartSnapped: UTCTimestamp | null = null;
  private _popup: HTMLDivElement | null = null;
  private _popupSummary: HTMLDivElement | null = null;
  private _popupRange: HTMLDivElement | null = null;
  private readonly _onDragMove = (e: MouseEvent) => this._handleDragMove(e);
  private readonly _onDragEnd = (e: MouseEvent) => this._handleDragEnd(e);

  constructor(private readonly _deps: SelectionToolDeps) {
    this._deps.series.attachPrimitive(this._band);
    this._deps.container.addEventListener('mousedown', (e) => this._handleMouseDown(e));
  }

  /** Whether the tool is armed (chart cursor becomes crosshair). */
  isActive(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    if (this._enabled === on) return;
    this._enabled = on;
    if (!on) this.clear();
    this._deps.onStateChange?.();
  }

  /**
   * Re-read the dataset, re-snap the range edges to actual bars, and update
   * the popup summary. Call after anything that changes the effective data
   * (timeframe switch, replay step). Edges must exist as bar times in the
   * active dataset, otherwise the band cannot render (timeToCoordinate
   * returns null for unknown times).
   */
  refresh(): void {
    if (!this._range || this._dragging) return;
    const dataset = this._deps.getDataset();
    if (dataset.length === 0) {
      this.clear();
      return;
    }
    const startIdx = nearestIndexByTime(dataset, this._range.start as number);
    const endIdx = nearestIndexByTime(dataset, this._range.end as number);
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    this._range = {
      start: dataset[lo]!.time as UTCTimestamp,
      end: dataset[hi]!.time as UTCTimestamp,
    };
    this._band.setRange(this._range);
    if (!this._popup || !this._popup.isConnected) return;
    this._updatePopupSummary();
  }

  /** Escape: cancel an in-flight drag, else clear the selection. Tool stays armed. */
  handleEscape(): void {
    if (this._dragging) {
      window.removeEventListener('mousemove', this._onDragMove);
      window.removeEventListener('mouseup', this._onDragEnd);
      this._dragging = false;
    }
    this.clear();
  }

  /** Clear band + popup. */
  clear(): void {
    this._range = null;
    this._band.setRange(null);
    this._hidePopup();
  }

  // ---- drag lifecycle ----------------------------------------------------

  private _handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || !this._enabled) return;
    if (this._deps.isInterceptBlocked?.()) return;
    const start = this._snapTime(e.clientX);
    if (start == null) return;
    this._dragging = true;
    this._dragStartClientX = e.clientX;
    this._dragStartSnapped = start;
    this._hidePopup();
    window.addEventListener('mousemove', this._onDragMove);
    window.addEventListener('mouseup', this._onDragEnd);
    e.preventDefault();
  }

  private _handleDragMove(e: MouseEvent): void {
    if (!this._dragging || this._dragStartSnapped == null) return;
    const end = this._snapTime(e.clientX);
    if (end == null) return;
    this._setRange({ start: this._dragStartSnapped, end });
  }

  private _handleDragEnd(e: MouseEvent): void {
    if (!this._dragging) return;
    this._dragging = false;
    window.removeEventListener('mousemove', this._onDragMove);
    window.removeEventListener('mouseup', this._onDragEnd);
    if (this._range == null || Math.abs(e.clientX - this._dragStartClientX) < DRAG_MIN_PX) {
      // A click, not a drag: treat as cancel.
      this.clear();
      return;
    }
    this._showPopup(e.clientX, e.clientY);
  }

  private _setRange(range: { start: UTCTimestamp; end: UTCTimestamp }): void {
    this._range =
      range.start <= range.end ? range : { start: range.end, end: range.start };
    this._band.setRange(this._range);
  }

  /**
   * Snap a viewport x coordinate to the nearest actual bar time in the
   * effective dataset (clamped to the first/last bar).
   */
  private _snapTime(clientX: number): UTCTimestamp | null {
    const dataset = this._deps.getDataset();
    if (dataset.length === 0) return null;

    const rect = this._deps.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const timeScale = this._deps.chart.timeScale();

    const first = dataset[0]!.time as number;
    const last = dataset[dataset.length - 1]!.time as number;
    const firstX = timeScale.timeToCoordinate(first as UTCTimestamp);
    const lastX = timeScale.timeToCoordinate(last as UTCTimestamp);
    if (firstX != null && x <= firstX) return first as UTCTimestamp;
    if (lastX != null && x >= lastX) return last as UTCTimestamp;

    const t = timeScale.coordinateToTime(x);
    if (t == null) return null;
    return dataset[nearestIndexByTime(dataset, t as number)]!.time as UTCTimestamp;
  }

  // ---- popup -------------------------------------------------------------

  private _showPopup(anchorX: number, anchorY: number): void {
    if (!this._popup) this._popup = this._buildPopup();
    this._updatePopupSummary();
    document.body.appendChild(this._popup);
    // Position after insertion so offsetWidth/Height are real.
    const w = this._popup.offsetWidth;
    const h = this._popup.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, anchorX + 14));
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, anchorY - h / 2));
    this._popup.style.left = `${left}px`;
    this._popup.style.top = `${top}px`;
  }

  private _hidePopup(): void {
    if (this._popup && this._popup.isConnected) this._popup.remove();
  }

  private _updatePopupSummary(): void {
    if (!this._popupSummary || !this._popupRange || !this._range) return;
    const bars = this._selectedBars();
    const tf = this._deps.getTimeframeLabel();
    const start = formatBarTime(this._range.start as number).slice(0, 16);
    const end = formatBarTime(this._range.end as number).slice(0, 16);
    this._popupSummary.textContent = `${this._deps.symbol} ${tf} · ${bars.length} bars`;
    this._popupRange.textContent = `${start} → ${end} UTC`;
  }

  private _selectedBars(): OhlcvBar[] {
    if (!this._range) return [];
    const dataset = this._deps.getDataset();
    const from = lowerBoundByTime(dataset, this._range.start as number);
    const to = upperBoundByTime(dataset, this._range.end as number);
    return dataset.slice(from, to);
  }

  private _buildPopup(): HTMLDivElement {
    const popup = document.createElement('div');
    popup.id = 'selection-popup';
    Object.assign(popup.style, {
      position: 'absolute',
      zIndex: '30',
      background: '#0f1520',
      color: '#d1d4dc',
      border: '1px solid #2a3551',
      borderRadius: '8px',
      padding: '12px 14px',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: '24px',
      userSelect: 'none',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
    } satisfies Partial<CSSStyleDeclaration>);

    this._popupSummary = document.createElement('div');
    this._popupSummary.textContent = '';

    this._popupRange = document.createElement('div');
    Object.assign(this._popupRange.style, {
      fontSize: '20px',
      color: '#8a92a6',
      marginTop: '2px',
    } satisfies Partial<CSSStyleDeclaration>);
    this._popupRange.textContent = '';

    const buttons = document.createElement('div');
    Object.assign(buttons.style, {
      display: 'flex',
      gap: '8px',
      marginTop: '10px',
    } satisfies Partial<CSSStyleDeclaration>);

    const makeButton = (text: string, onClick: (btn: HTMLButtonElement) => void) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      Object.assign(btn.style, {
        background: '#1c2740',
        color: '#d1d4dc',
        border: '1px solid #3b4a6b',
        borderRadius: '6px',
        padding: '6px 12px',
        fontSize: '22px',
        cursor: 'pointer',
      } satisfies Partial<CSSStyleDeclaration>);
      btn.addEventListener('click', () => onClick(btn));
      return btn;
    };

    buttons.appendChild(
      makeButton('Export CSV', () => {
        const bars = this._selectedBars();
        if (bars.length === 0 || !this._range) return;
        downloadTextFile(
          buildCsvFilename(
            this._deps.symbol,
            this._deps.getTimeframeLabel(),
            this._range
          ),
          barsToCsv(bars)
        );
      })
    );

    buttons.appendChild(
      makeButton('Copy Markdown', async (btn) => {
        const bars = this._selectedBars();
        if (bars.length === 0 || !this._range) return;
        const start = formatBarTime(this._range.start as number).slice(0, 16);
        const end = formatBarTime(this._range.end as number).slice(0, 16);
        const header = `## ${this._deps.symbol} ${this._deps.getTimeframeLabel()} — ${bars.length} bars — ${start} → ${end} UTC`;
        const ok = await copyTextToClipboard(barsToMarkdown(bars, header));
        btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
        window.setTimeout(() => {
          btn.textContent = 'Copy Markdown';
        }, 1200);
      })
    );

    buttons.appendChild(
      makeButton('Clear', () => {
        this.clear();
      })
    );

    popup.appendChild(this._popupSummary);
    popup.appendChild(this._popupRange);
    popup.appendChild(buttons);
    return popup;
  }
}
