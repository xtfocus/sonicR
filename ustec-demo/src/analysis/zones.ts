/**
 * Zone layer: fair-value gaps, BOS-anchored order blocks, pivot-anchored
 * supply/demand bases, zone lifecycle tracking, confluence merging and
 * liquidity reference levels.
 *
 * All finders return {@link Zone} objects evaluated against the bars after
 * creation (`state`, `firstTouch`, `invalidatedAt`), so a caller sees both
 * the geometry and "is this zone still tradeable" in one pass. Everything
 * is computed from bar closes/wicks only — no repaint possible.
 */

import type { Dir, LiquidityLevel, OhlcvBar, Pivot, Zone, ZoneKind, ZoneState } from './types';
import { detectBos } from './structure';

export type FvgOptions = {
  /** Minimum gap height in price points; smaller gaps are ignored. */
  minGap?: number;
};

/**
 * Find fair-value gaps (3-bar imbalances).
 *
 * Bullish FVG at bar `i`: `low[i] > high[i-2]` — the middle bar moved so
 * fast it left a gap between the first bar's high and the third bar's low.
 * Zone bounds are the gap itself (`top = low[i]`, `bottom = high[i-2]`),
 * created at the middle (displacement) bar. Bearish mirrors it.
 *
 * @param opts.minGap Filter out gaps smaller than this many price points.
 */
export function findFvgs(bars: OhlcvBar[], opts: FvgOptions = {}): Zone[] {
  const zones: Array<Zone & { evalFrom: number }> = [];
  const minGap = opts.minGap ?? 0;
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!;
    const c = bars[i]!;
    const middle = bars[i - 1]!;
    const bullGap = c.low - a.high;
    const bearGap = a.low - c.high;
    if (bullGap > minGap && bullGap > 0) {
      // The third bar completes the gap pattern; lifecycle starts after it.
      zones.push(makeZone('FVG', 'bull', middle.time, c.low, a.high, c.time));
    } else if (bearGap > minGap && bearGap > 0) {
      zones.push(makeZone('FVG', 'bear', middle.time, a.low, c.high, c.time));
    }
  }
  return zones.map((z) => withState(bars, z));
}

/**
 * Find BOS-anchored order blocks.
 *
 * For every break of structure, walk back from the breaking bar to the
 * last opposite-direction candle before the impulse leg — that candle's
 * range is the order block: the bull OB before an up-break (demand),
 * the bear OB before a down-break (supply). Zones with no opposite
 * candle in the lookback are skipped.
 *
 * @param pivots Confirmed pivots of the same series (see `findPivots`).
 * @param maxLookback Bars to walk back from the break hunting the OB candle.
 * @param bodyOnly Use only the candle body (open↔close) instead of full range.
 */
export function findOrderBlocks(
  bars: OhlcvBar[],
  pivots: Pivot[],
  maxLookback = 10,
  bodyOnly = false
): Zone[] {
  const zones: Array<Zone & { evalFrom: number }> = [];
  for (const bos of detectBos(bars, pivots)) {
    for (let j = bos.index; j >= Math.max(0, bos.index - maxLookback); j--) {
      const bar = bars[j]!;
      const down = bar.close < bar.open;
      const up = bar.close > bar.open;
      const isOpposite = bos.dir === 'bull' ? down : up;
      if (!isOpposite) continue;
      const top = bodyOnly ? Math.max(bar.open, bar.close) : bar.high;
      const bottom = bodyOnly ? Math.min(bar.open, bar.close) : bar.low;
      // Lifecycle starts at the break: the impulse between the OB candle
      // and the BOS necessarily passes through the zone.
      if (top > bottom) zones.push(makeZone('OB', bos.dir, bar.time, top, bottom, bos.time));
      break;
    }
  }
  return zones.map((z) => withState(bars, z));
}

/**
 * Find pivot-anchored supply/demand bases.
 *
 * A confirmed pivot low implies buyers defended a base just before it:
 * the base is the high↔low range of the `baseBars` candles preceding the
 * pivot bar → a demand (bull) zone. Pivot highs mirror to supply (bear)
 * zones. This is the coarsest zone finder — treat it as background map,
 * refined by FVG/OB overlaps (see {@link mergeZones}).
 *
 * @param baseBars Size of the consolidation window before each pivot.
 */
export function findSupplyDemand(bars: OhlcvBar[], pivots: Pivot[], baseBars = 3): Zone[] {
  const zones: Array<Zone & { evalFrom: number }> = [];
  for (const pivot of pivots) {
    const start = Math.max(0, pivot.index - baseBars);
    let top = -Infinity;
    let bottom = Infinity;
    for (let j = start; j < pivot.index; j++) {
      top = Math.max(top, bars[j]!.high);
      bottom = Math.min(bottom, bars[j]!.low);
    }
    if (top <= bottom || !Number.isFinite(top)) continue;
    // Demand base sits under a pivot low; supply base sits over a pivot
    // high. The pivot bar completes the pattern — lifecycle starts after it.
    zones.push(
      makeZone(
        'SD',
        pivot.kind === 'low' ? 'bull' : 'bear',
        bars[start]!.time,
        top,
        bottom,
        pivot.time
      )
    );
  }
  return zones.map((z) => withState(bars, z));
}

export type MergeZonesOptions = {
  /**
   * Max creation-time distance for two overlapping zones to merge, in
   * seconds. Price overlap alone is not enough: on a trending month,
   * same-direction zones from different weeks overlap in price and would
   * chain into one mega-zone spanning the whole range. Default ~5 days.
   */
  maxAgeSeconds?: number;
};

/**
 * Merge overlapping same-direction zones into confluence POIs.
 *
 * Two zones merge when their price ranges overlap **and** they were
 * created within `maxAgeSeconds` of each other. The merged zone spans
 * the union; `provenance` collects every contributing kind —
 * `['OB','FVG']` is one zone with two logics behind it, which is exactly
 * how double-counting "three confirmations at one price" is avoided.
 * Opposite-direction zones never merge (support vs resistance).
 */
export function mergeZones(zones: Zone[], opts: MergeZonesOptions = {}): Zone[] {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 5 * 86400;
  const byDir: Record<Dir, Zone[]> = { bull: [], bear: [] };
  for (const z of zones) byDir[z.dir].push({ ...z });

  const merged: Zone[] = [];
  for (const group of [byDir.bull, byDir.bear]) {
    group.sort((a, b) => a.bottom - b.bottom);
    let current: Zone | null = null;
    for (const z of group) {
      const overlapsInPrice = current != null && z.bottom <= current.top;
      const closeInTime =
        current != null && Math.abs(z.tCreated - current.tCreated) <= maxAgeSeconds;
      if (current && overlapsInPrice && closeInTime) {
        current.top = Math.max(current.top, z.top);
        current.tCreated = Math.min(current.tCreated, z.tCreated);
        for (const kind of z.provenance) {
          if (!current.provenance.includes(kind)) current.provenance.push(kind);
        }
        // The most degraded (least tradeable) state wins for the union.
        const rank: Record<ZoneState, number> = { fresh: 0, touched: 1, mitigated: 2, broken: 3 };
        if (rank[z.state] > rank[current.state]) current.state = z.state;
        current.firstTouch = minNull(current.firstTouch, z.firstTouch);
        current.invalidatedAt = minNull(current.invalidatedAt, z.invalidatedAt);
      } else {
        current = { ...z, provenance: [...z.provenance] };
        merged.push(current);
      }
    }
  }
  return merged;
}

export type LiquidityOptions = {
  /** Pivot window for equal-high/low clustering. */
  k?: number;
  /** Cluster tolerance as a fraction of price (0.001 = 0.1%). */
  tolerance?: number;
};

/**
 * Map liquidity reference levels: old extremes and equal highs/lows.
 *
 * - `old_high`/`old_low`: the extreme of the series — the draw-in targets
 *   the entry model aims take-profits at.
 * - `equal_high`/`equal_low`: pivot clusters of ≥ 2 pivots within
 *   `tolerance` relative price distance — pools of resting stops.
 */
export function liquidityLevels(bars: OhlcvBar[], pivots: Pivot[], opts: LiquidityOptions = {}): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  if (bars.length === 0) return levels;
  const tolerance = opts.tolerance ?? 0.001;

  let hi = bars[0]!;
  let lo = bars[0]!;
  for (const b of bars) {
    if (b.high > hi.high) hi = b;
    if (b.low < lo.low) lo = b;
  }
  levels.push({ kind: 'old_high', price: hi.high, time: hi.time, note: 'highest high of the evaluated range' });
  levels.push({ kind: 'old_low', price: lo.low, time: lo.time, note: 'lowest low of the evaluated range' });

  for (const kind of ['high', 'low'] as const) {
    const group = pivots.filter((p) => p.kind === kind).sort((a, b) => a.price - b.price);
    let cluster: Pivot[] = [];
    const flush = () => {
      if (cluster.length >= 2) {
        const avg = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
        levels.push({
          kind: kind === 'high' ? 'equal_high' : 'equal_low',
          price: avg,
          time: cluster[cluster.length - 1]!.time,
          note: `${cluster.length} pivots within ${(tolerance * 100).toFixed(2)}%`,
        });
      }
      cluster = [];
    };
    for (const p of group) {
      if (cluster.length === 0 || Math.abs(p.price - cluster[0]!.price) / cluster[0]!.price <= tolerance) {
        cluster.push(p);
      } else {
        flush();
        cluster = [p];
      }
    }
    flush();
  }
  return levels;
}

/**
 * Construct a fresh zone (before lifecycle evaluation).
 *
 * `evalFrom` is when the zone's *defining pattern completes* — lifecycle
 * evaluation starts strictly after it. It differs from `tCreated`: e.g.
 * an FVG's third bar defines the gap's edge, so that bar must not count
 * as a "touch" of its own zone.
 */
function makeZone(
  kind: ZoneKind,
  dir: Dir,
  tCreated: number,
  top: number,
  bottom: number,
  evalFrom = tCreated
): Zone & { evalFrom: number } {
  return {
    kind,
    dir,
    tCreated,
    top,
    bottom,
    state: 'fresh',
    firstTouch: null,
    invalidatedAt: null,
    provenance: [kind],
    evalFrom,
  };
}

/**
 * Evaluate a zone's lifecycle against bars after its pattern completes.
 *
 * Walks ascending bars from `evalFrom`; a zone stops evolving once
 * broken. Rules, in increasing severity:
 *
 * - **touched**   — a later bar wicks into the zone but closes outside it
 * - **mitigated** — a later bar *closes* inside the zone (the imbalance
 *   has been filled; conservative models stand down here)
 * - **broken**    — a later bar closes fully beyond the far edge (bull
 *   zone broken by a close below `bottom`; bear zone by a close above
 *   `top`); `invalidatedAt` records when.
 */
function withState(bars: OhlcvBar[], zone: Zone & { evalFrom: number }): Zone {
  let state: ZoneState = 'fresh';
  let firstTouch: number | null = null;
  let invalidatedAt: number | null = null;

  for (const bar of bars) {
    if (bar.time <= zone.evalFrom) continue;
    if (invalidatedAt != null) break;

    const wickIn = bar.high >= zone.bottom && bar.low <= zone.top;
    const closeIn = bar.close >= zone.bottom && bar.close <= zone.top;
    const closeBeyond = zone.dir === 'bull' ? bar.close < zone.bottom : bar.close > zone.top;

    if (wickIn && firstTouch == null) firstTouch = bar.time;
    if (closeBeyond) {
      invalidatedAt = bar.time;
      state = 'broken';
    } else if (closeIn) {
      state = 'mitigated';
    } else if (wickIn && state === 'fresh') {
      state = 'touched';
    }
  }
  const { evalFrom: _evalFrom, ...rest } = zone;
  return { ...rest, state, firstTouch, invalidatedAt };
}

function minNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}
