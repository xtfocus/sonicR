/**
 * Composition layer: HTF bias → confluence POIs → LTF trigger → risk-shaped
 * entry signals.
 *
 * This module wires the layers together exactly the way the top-down
 * methodology prescribes:
 *
 * 1. {@link marketBias}  — structure on the higher timeframe decides which
 *    side may trade (`stand_aside` in a range — the implicit chop filter).
 * 2. {@link findPois}    — all zone finders run, zones merge into POIs,
 *    only still-tradeable zones on the right side of price survive.
 * 3. {@link entrySignals} — price must *arrive* at a POI, then an internal
 *    CHoCH on the lower timeframe fires the entry; stop lands beyond the
 *    POI, targets at opposing liquidity, minimum R:R gates the result.
 *
 * `entrySignals` is the only public composite; the two helpers are exported
 * because they are useful dashboard output on their own.
 */

import type {
  Bias,
  EntrySignal,
  LiquidityLevel,
  OhlcvBar,
  Poi,
  StructureKind,
  ZoneState,
} from './types';
import { classifyStructure, detectChoch, findPivots } from './structure';
import { findFvgs, findOrderBlocks, findSupplyDemand, liquidityLevels, mergeZones } from './zones';

export type BiasResult = {
  bias: Bias;
  structure: StructureKind;
  /** Pivots the classification was computed over. */
  pivotCount: number;
};
/**
 * Structure-derived directional bias for one series.
 *
 * HH_HL → `long_only`, LH_LL → `short_only`, RANGE → `stand_aside`.
 * The caller decides which timeframe is "HTF" (typically D1/H4).
 */
export function marketBias(bars: OhlcvBar[], k = 5, lookback = 6): BiasResult {
  const pivots = findPivots(bars, k);
  const structure = classifyStructure(pivots, lookback);
  const bias: Bias =
    structure === 'HH_HL' ? 'long_only' : structure === 'LH_LL' ? 'short_only' : 'stand_aside';
  return { bias, structure, pivotCount: pivots.length };
}

export type PoiOptions = {
  /** Pivot window for zone anchoring (same `k` as `findPivots`). */
  k?: number;
  /** Include zones whose state is `mitigated` (default: fresh/touched only). */
  includeMitigated?: boolean;
  /** Max POIs returned, nearest to current price first. */
  limit?: number;
};

/**
 * Confluence points of interest for a bias.
 *
 * FVG + order-block + supply/demand zones are merged; survivors must be
 * on the tradeable side (bull zones below price for `long_only`, bear
 * zones above for `short_only`) and not broken. `confluenceCount` is the
 * number of *distinct* logics behind the POI — the de-duplicated
 * confluence score.
 */
export function findPois(bars: OhlcvBar[], bias: Bias, opts: PoiOptions = {}): Poi[] {
  if (bias === 'stand_aside' || bars.length === 0) return [];
  const k = opts.k ?? 5;
  const pivots = findPivots(bars, k);
  const zones = mergeZones([
    ...findFvgs(bars),
    ...findOrderBlocks(bars, pivots),
    ...findSupplyDemand(bars, pivots),
  ]);
  const tradeable = (state: ZoneState) =>
    state === 'fresh' || state === 'touched' || (opts.includeMitigated === true && state === 'mitigated');
  const lastClose = bars[bars.length - 1]!.close;

  return zones
    .filter((z) => tradeable(z.state))
    .filter((z) =>
      bias === 'long_only'
        ? z.dir === 'bull' && z.top < lastClose
        : z.dir === 'bear' && z.bottom > lastClose
    )
    .map((z) => ({ ...z, confluenceCount: z.provenance.length }))
    .sort((a, b) => (bias === 'long_only' ? b.top - a.top : a.bottom - b.bottom))
    .slice(0, opts.limit ?? 5);
}

export type EntrySignalOptions = {
  /** Pivot window on the HTF series (structure + zone anchoring). */
  htfK?: number;
  /** Pivot window on the LTF series (internal trigger structure). */
  ltfK?: number;
  /** Minimum reward:risk of the first target; signals below it drop. */
  minRR?: number;
  /** Stop buffer beyond the POI far edge, as a fraction of price. */
  stopBuffer?: number;
  /** Max signals returned (most recent first). */
  limit?: number;
};

export type EntrySignalResult = {
  bias: BiasResult;
  /** POIs that were armed for entries. */
  pois: Poi[];
  signals: EntrySignal[];
  liquidity: LiquidityLevel[];
};

/**
 * The full composite: bias ∧ POI-arrival ∧ internal-CHoCH ∧ R:R gate.
 *
 * Evaluation per POI (point-in-time ordered, no lookahead):
 *
 * 1. **Arrival** — first LTF bar *after zone creation* whose range enters
 *    the zone. No arrival, no signal: blank-space entries are impossible
 *    by construction.
 * 2. **Trigger** — the first LTF CHoCH in the bias direction at or after
 *    the arrival bar. This is the Sonic R internal-structure shift.
 * 3. **Risk** — entry at the zone's near edge, stop beyond the far edge
 *    plus `stopBuffer` (fraction of price), targets at opposing HTF
 *    liquidity (nearest first); `rr` is the first target's reward over
 *    risk and must clear `minRR`.
 *
 * @param htfBars Higher-timeframe bars (bias + POIs + targets).
 * @param ltfBars Lower-timeframe bars for the trigger. Falls back to
 *                `htfBars` when omitted (self-timeframe triggering).
 */
export function entrySignals(
  htfBars: OhlcvBar[],
  ltfBars: OhlcvBar[] = htfBars,
  opts: EntrySignalOptions = {}
): EntrySignalResult {
  const htfK = opts.htfK ?? 5;
  const ltfK = opts.ltfK ?? 3;
  const minRR = opts.minRR ?? 2;
  const stopBuffer = opts.stopBuffer ?? 0.0005;

  const bias = marketBias(htfBars, htfK);
  const pois = findPois(htfBars, bias.bias, { k: htfK });
  const htfPivots = findPivots(htfBars, htfK);
  const liquidity = liquidityLevels(htfBars, htfPivots);
  if (bias.bias === 'stand_aside' || ltfBars.length === 0) {
    return { bias, pois, signals: [], liquidity };
  }

  const ltfChoch = detectChoch(ltfBars, findPivots(ltfBars, ltfK));
  const signals: EntrySignal[] = [];

  for (const poi of pois) {
    const arrivalIndex = ltfBars.findIndex(
      (b) => b.time > poi.tCreated && b.high >= poi.bottom && b.low <= poi.top
    );
    if (arrivalIndex < 0) continue;
    const arrivalTime = ltfBars[arrivalIndex]!.time;

    const trigger = ltfChoch.find(
      (e) => e.time >= arrivalTime && (e.dir === 'bull') === (bias.bias === 'long_only')
    );
    if (!trigger) continue;

    const near = bias.bias === 'long_only' ? poi.top : poi.bottom;
    const far = bias.bias === 'long_only' ? poi.bottom : poi.top;
    const entry = near;
    const stop = bias.bias === 'long_only' ? far * (1 - stopBuffer) : far * (1 + stopBuffer);
    const targets = liquidity
      .filter((l) => (bias.bias === 'long_only' ? l.price > entry : l.price < entry))
      .map((l) => l.price)
      .sort((a, b) => (bias.bias === 'long_only' ? a - b : b - a));
    const risk = Math.abs(entry - stop);
    const rr = targets.length > 0 ? Math.abs(targets[0]! - entry) / risk : null;
    if (rr != null && rr < minRR) continue;

    signals.push({
      dir: bias.bias === 'long_only' ? 'bull' : 'bear',
      bias: bias.bias,
      poi,
      triggerTime: trigger.time,
      entry,
      stop,
      targets,
      rr,
    });
  }

  signals.sort((a, b) => b.triggerTime - a.triggerTime);
  return { bias, pois, signals: signals.slice(0, opts.limit ?? 3), liquidity };
}
