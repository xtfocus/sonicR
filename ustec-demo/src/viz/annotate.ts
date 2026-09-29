/**
 * Freeform annotation parsing — `--annotate '<kind>@<geometry>[@label]'`
 * strings → overlay primitives.
 *
 * The field separator is `@` because time values contain colons.
 *
 * ```
 * level@<price>[@label]                 e.g. level@24600@watch
 * vline@<time>[@label]                  e.g. vline@2025-08-05 10:00@CPI
 * marker@<time>@<shape>[@label]         shape: triangle-up|triangle-down|dot|cross|arrow-up|arrow-down
 * text@<time>,<price>@<text>            e.g. text@2025-08-05 10:00,25100@note
 * zone@<bottom>,<top>@<bull|bear>[@label]
 * ```
 *
 * Times accept the same formats as every other API (UTC epoch seconds,
 * 'YYYY-MM-DD[ T]HH:MM[:SS]', date-only, ISO 8601 with timezone) — the
 * caller supplies the parser so this module stays environment-free.
 */

import type { Overlay } from './types';

const SHAPES = new Set(['triangle-up', 'triangle-down', 'dot', 'cross', 'arrow-up', 'arrow-down']);

/**
 * Parse annotation strings. Throws with the offending item and the
 * accepted grammar when anything fails (same error style as the rest).
 *
 * @param items      Raw `--annotate` values.
 * @param parseTime  Time-string → UTC seconds (null when invalid).
 */
export function parseAnnotations(
  items: string[],
  parseTime: (input: string) => number | null
): Overlay[] {
  const overlays: Overlay[] = [];
  for (const raw of items) {
    if (raw === '') continue;
    const parts = raw.split('@');
    const kind = parts[0];
    switch (kind) {
      case 'level': {
        const price = Number(parts[1]);
        if (!Number.isFinite(price)) throw bad(raw, 'level@<price>[@label]');
        overlays.push({ type: 'level', price, label: parts.slice(2).join('@') || undefined });
        break;
      }
      case 'vline': {
        const time = parseTime(parts[1] ?? '');
        if (time == null) throw bad(raw, "vline@<time>[@label] — time like '2025-08-05 10:00'");
        overlays.push({ type: 'vline', time, label: parts.slice(2).join('@') || undefined });
        break;
      }
      case 'marker': {
        const time = parseTime(parts[1] ?? '');
        const shape = parts[2];
        if (time == null) throw bad(raw, 'marker@<time>@<shape>[@label]');
        if (shape == null || !SHAPES.has(shape)) {
          throw bad(raw, `marker@<time>@<shape>[@label] — shape one of ${[...SHAPES].join('|')}`);
        }
        overlays.push({
          type: 'marker',
          time,
          shape: shape as 'triangle-up' | 'triangle-down' | 'dot' | 'cross' | 'arrow-up' | 'arrow-down',
          label: parts.slice(3).join('@') || undefined,
        });
        break;
      }
      case 'text': {
        const [timeRaw, priceRaw] = (parts[1] ?? '').split(',');
        const time = parseTime(timeRaw ?? '');
        const price = Number(priceRaw);
        if (time == null || !Number.isFinite(price)) {
          throw bad(raw, 'text@<time>,<price>@<text> — e.g. text@2025-08-05 10:00,25100@note');
        }
        const text = parts.slice(2).join('@');
        if (text === '') throw bad(raw, 'text@<time>,<price>@<text> — text is required');
        overlays.push({ type: 'text', time, price, text });
        break;
      }
      case 'zone': {
        const [bottomRaw, topRaw] = (parts[1] ?? '').split(',');
        const bottom = Number(bottomRaw);
        const top = Number(topRaw);
        const dir = parts[2];
        if (!Number.isFinite(bottom) || !Number.isFinite(top) || (dir !== 'bull' && dir !== 'bear')) {
          throw bad(raw, 'zone@<bottom>,<top>@<bull|bear>[@label]');
        }
        overlays.push({
          type: 'zone',
          bottom,
          top,
          fromTime: 0,
          dir,
          label: parts.slice(3).join('@') || undefined,
          state: 'fresh',
        });
        break;
      }
      default:
        throw new Error(
          `Invalid --annotate '${raw}': unknown kind '${kind}'. Accepted: level, vline, marker, text, zone.`
        );
    }
  }
  return overlays;
}

function bad(raw: string, grammar: string): Error {
  return new Error(`Invalid --annotate '${raw}': expected ${grammar}.`);
}
