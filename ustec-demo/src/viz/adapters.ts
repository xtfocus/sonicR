/**
 * Analysis → overlay adapters.
 *
 * Each adapter takes a typed output of the analysis library and returns
 * plain overlay primitives (see `src/viz/types.ts`). Adapters are dumb
 * mappings — no geometry, no styling decisions beyond semantic hints
 * (dir, state) that the theme resolves. This keeps the visual grammar in
 * the theme and the semantics in the adapters.
 */

import type {
  BosEvent,
  ChochEvent,
  EntrySignal,
  LiquidityLevel,
  OhlcvBar,
  Pivot,
  Poi,
  Zone,
} from '../analysis/types';
import type {
  BracketOverlay,
  LevelOverlay,
  MarkerOverlay,
  PolylineOverlay,
  TextOverlay,
  ZoneOverlay,
} from './types';

/**
 * Zigzag through confirmed pivots — the structural spine of every chart.
 */
export function pivotPolyline(pivots: Pivot[]): PolylineOverlay {
  return {
    type: 'polyline',
    points: pivots.map((p) => ({ time: p.time, price: p.price })),
  };
}

/**
 * A/B/C labels: pivot *i* takes letter *i* (matching `labelLegs`, where
 * the leg from pivot i to i+1 is letter i). Cosmetic — visualizes
 * "price goes A→D→F, never A→Z in one leg".
 */
export function legLabels(pivots: Pivot[]): TextOverlay[] {
  return pivots.map((pivot, i) => ({
    type: 'text',
    time: pivot.time,
    price: pivot.price,
    text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26]!,
    anchor: pivot.kind === 'high' ? ('left' as const) : ('right' as const),
  }));
}
/** BOS events as bar markers with labels. */
export function bosMarkers(events: BosEvent[]): MarkerOverlay[] {
  return events.map((e) => ({
    type: 'marker',
    time: e.time,
    shape: e.dir === 'bull' ? ('triangle-up' as const) : ('triangle-down' as const),
    label: 'BOS',
  }));
}

/** CHoCH events as markers — visually distinct via label. */
export function chochMarkers(events: ChochEvent[]): MarkerOverlay[] {
  return events.map((e) => ({
    type: 'marker',
    time: e.time,
    shape: e.dir === 'bull' ? ('arrow-up' as const) : ('arrow-down' as const),
    label: 'CHoCH',
  }));
}

/**
 * Zones (analysis output) → zone overlays. Label packs the confluence
 * story: provenance kinds + state, e.g. `OB+FVG · fresh`.
 */
export function zoneOverlays(zones: Array<Zone | Poi>): ZoneOverlay[] {
  return zones.map((z) => ({
    type: 'zone',
    top: z.top,
    bottom: z.bottom,
    fromTime: z.tCreated,
    dir: z.dir,
    state: z.state,
    label: `${z.provenance.join('+')}${'confluenceCount' in z && z.confluenceCount > 1 ? ` (×${z.confluenceCount})` : ''} · ${z.state}`,
  }));
}

/** Liquidity levels → labeled horizontal lines. */
export function liquidityOverlays(levels: LiquidityLevel[]): LevelOverlay[] {
  const nameByKind: Record<LiquidityLevel['kind'], string> = {
    old_high: 'old high',
    old_low: 'old low',
    equal_high: 'EQH',
    equal_low: 'EQL',
  };
  return levels.map((l) => {
    const count = /(\d+) pivots/.exec(l.note)?.[1];
    return {
      type: 'level',
      price: l.price,
      label: `${nameByKind[l.kind]}${count != null ? ` ×${count}` : ''} ${l.price.toFixed(0)}`,
      dashed: l.kind.startsWith('equal'),
    };
  });
}

/**
 * One entry signal → the full trade picture: the POI zone, a trigger
 * marker at the CHoCH time, and the entry/stop/target bracket with R:R.
 */
export function signalOverlays(signal: EntrySignal): Array<ZoneOverlay | MarkerOverlay | BracketOverlay | TextOverlay> {
  const zone = zoneOverlays([signal.poi])[0]!;
  const trigger: MarkerOverlay = {
    type: 'marker',
    time: signal.triggerTime,
    shape: signal.dir === 'bull' ? 'arrow-up' : 'arrow-down',
    label: `trigger ${signal.dir}`,
  };
  const bracket: BracketOverlay = {
    type: 'bracket',
    dir: signal.dir,
    entry: signal.entry,
    stop: signal.stop,
    target: signal.targets[0] ?? signal.entry,
    startTime: signal.poi.firstTouch ?? signal.poi.tCreated,
    rr: signal.rr ?? undefined,
  };
  const note: TextOverlay = {
    type: 'text',
    time: signal.triggerTime,
    price: signal.dir === 'bull' ? signal.stop : signal.stop,
    text: `${signal.dir.toUpperCase()} · entry ${signal.entry.toFixed(0)} · stop ${signal.stop.toFixed(0)} · ${signal.targets.length} target(s)`,
    anchor: 'left',
  };
  return [zone, trigger, bracket, note];
}

/** Bars for a time window (used by composites that trim context). */
export function barsWindow(bars: OhlcvBar[], fromTime: number, padBars = 40): OhlcvBar[] {
  let start = bars.findIndex((b) => b.time >= fromTime);
  if (start < 0) start = bars.length - 1;
  return bars.slice(Math.max(0, start - padBars));
}
