/**
 * Shared types for the analysis function library (`src/analysis/`).
 *
 * The library is pure: every function takes bars (and numeric parameters)
 * and returns plain JSON-serializable objects — no DOM, no Node APIs — so
 * the exact same code runs in the browser, the CLI and the HTTP server.
 *
 * ## Point-in-time safety (the one rule that matters)
 *
 * Any value derived from a *future* bar is a repaint. To make repainting
 * impossible, every confirmed-but-lagging artifact carries both:
 *
 * - `time`     — when the artifact *happened* (the pivot bar's open time), and
 * - `confirmedAt` — the earliest bar close at which a rule-based trader
 *   could actually have known about it (`time + k * intervalSeconds` for a
 *   k-bar pivot confirmation).
 *
 * Downstream consumers (BOS/CHoCH, zones, signals) must key off
 * `confirmedAt`, never `time`. The functions in this library do that
 * internally; keep it that way if you extend them.
 */

import type { OhlcvBar } from '../sonic-r-order-blocks';

export type { OhlcvBar };

/** Direction of a directional artifact (zone, event, leg). */
export type Dir = 'bull' | 'bear';

/** Market structure classification over a window of pivots. */
export type StructureKind = 'HH_HL' | 'LH_LL' | 'RANGE';

/** Which side the structure allows trading on. */
export type Bias = 'long_only' | 'short_only' | 'stand_aside';

/**
 * A confirmed swing pivot — the atom of all structure analysis.
 *
 * A bar is a pivot *high* when its `high` is strictly greater than the
 * highs of the `k` bars on both sides (mirror for lows). It only becomes
 * *known* when the `k`-th right-side bar closes, hence `confirmedAt`.
 */
export type Pivot = {
  /** Bar index in the input series. */
  index: number;
  /** Open time of the pivot bar, UTC seconds. */
  time: number;
  /** Pivot price: `high` for highs, `low` for lows. */
  price: number;
  kind: 'high' | 'low';
  /**
   * UTC seconds of the close of the bar that completes the k-bar
   * confirmation window (the pivot bar + k later bars; the last input bar
   * bounds it when the window runs past the end of the data).
   */
  confirmedAt: number;
};

/** A labelled zigzag leg between consecutive opposite pivots. */
export type Leg = {
  /** Letter label cycling A, B, C, … (cosmetic — the Sonic R "A→D→F" view). */
  label: string;
  dir: Dir;
  from: { time: number; price: number; kind: 'high' | 'low' };
  to: { time: number; price: number; kind: 'high' | 'low' };
  /** Absolute price change from `from.price` to `to.price`. */
  delta: number;
  /** 50% retracement level of the leg (the Sonic R "EQ" / midpoint). */
  equilibrium: number;
};

/** Break of structure — close beyond the last confirmed same-side pivot. */
export type BosEvent = {
  kind: 'bos';
  dir: Dir;
  /** Structure level that was broken (the pivot price). */
  level: number;
  /** Time of the breaking bar close, UTC seconds. */
  time: number;
  /** Bar index of the breaking close. */
  index: number;
};

/** Change of character — first close against the prevailing leg. */
export type ChochEvent = {
  kind: 'choch';
  dir: Dir;
  level: number;
  time: number;
  index: number;
};

export type StructureEvent = BosEvent | ChochEvent;

/** Zone origin; a merged zone keeps every origin in `provenance`. */
export type ZoneKind = 'FVG' | 'OB' | 'SD';

/** Lifecycle of a zone as later bars interact with it. */
export type ZoneState = 'fresh' | 'touched' | 'mitigated' | 'broken';

/**
 * A horizontal price zone (FVG / order block / supply-demand base).
 *
 * Bull zones are expected to *support* price (demand); bear zones to
 * *resist* it (supply). `state` is evaluated against the bars after
 * `tCreated` (see `trackZoneStates`): `fresh` — never revisited;
 * `touched` — traded into but closed back out; `mitigated` — a later
 * close is inside the zone; `broken` — a later close is fully beyond it.
 */
export type Zone = {
  kind: ZoneKind;
  dir: Dir;
  /** Open time of the zone's defining bar, UTC seconds. */
  tCreated: number;
  /** Upper bound (inclusive). */
  top: number;
  /** Lower bound (inclusive). */
  bottom: number;
  /** Zone lifecycle at the end of the evaluated bars. */
  state: ZoneState;
  /** First time price traded into the zone after creation; null if never. */
  firstTouch: number | null;
  /** Time of the close that mitigated/broke the zone; null if still intact. */
  invalidatedAt: number | null;
  /** For merged zones: the kinds that overlap here, e.g. ['FVG','OB']. */
  provenance: ZoneKind[];
};

/** A liquidity reference level (old / equal highs and lows). */
export type LiquidityLevel = {
  kind: 'old_high' | 'old_low' | 'equal_high' | 'equal_low';
  price: number;
  time: number;
  /** Human-readable note, e.g. 'highest high of the lookback window'. */
  note: string;
};

/** Points of interest: merged, bias-filtered, still-tradeable zones. */
export type Poi = Zone & {
  /** Number of *distinct* zone kinds overlapping at this POI. */
  confluenceCount: number;
  provenance: ZoneKind[];
};

/** A composite entry signal produced by `entrySignals`. */
export type EntrySignal = {
  dir: Dir;
  /** HTF bias that gates the signal. */
  bias: Bias;
  /** POI the entry is anchored to. */
  poi: Poi;
  /** Time the internal CHoCH trigger fired (LTF bar close), UTC seconds. */
  triggerTime: number;
  /** Suggested limit entry: the near edge of the POI. */
  entry: number;
  /** Stop beyond the far edge of the POI plus a buffer. */
  stop: number;
  /** Ranked take-profit levels (opposing liquidity, nearest first). */
  targets: number[];
  /** Reward of `targets[0]` over risk (`entry` - `stop`); null without targets. */
  rr: number | null;
};

/** Common JSON envelope every registry function returns. */
export type AnalysisMeta = {
  /** Function id from the registry. */
  fn: string;
  /** Interval seconds of the evaluated series. */
  intervalSeconds: number;
  /** Evaluated bar count. */
  barCount: number;
  /** First/last evaluated bar time, UTC seconds; nulls when empty. */
  from: number | null;
  to: number | null;
};

export type AnalysisResult<T> = AnalysisMeta & { data: T };

/** Context handed to every registry handler. */
export type AnalysisContext = {
  /** Bars for the analysis timeframe, ascending, in [start, end]. */
  bars: OhlcvBar[];
  /** Lower-timeframe bars for trigger evaluation (only `signal` uses it). */
  ltfBars?: OhlcvBar[];
  /** Interval seconds of `bars` (for `confirmedAt` math and reporting). */
  intervalSeconds: number;
  /** Interval seconds of `ltfBars` when provided. */
  ltfIntervalSeconds?: number;
};
