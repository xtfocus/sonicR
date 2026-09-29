/**
 * Chart artifacts: PNG + sidecar manifest persistence under `reports/`.
 *
 * Conventions (the LLM contract for report assembly):
 *
 * ```
 * reports/<session>/
 *   manifest.json          # session index
 *   <id>.png               # the rendered chart
 *   <id>.json              # sidecar: caption, provenance, digest, sha256
 * ```
 *
 * The sidecar is the ground truth for captions — anything assembling an
 * HTML report reads `caption`/`analysisDigest` from it and never
 * re-derives numbers from pixels. `sha256` ties the PNG to its metadata
 * so references stay honest.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ChartSpec } from '../viz/types';
import type { RenderedPng } from '../viz/png';

const REPORTS_ROOT = fileURLToPath(new URL('../../reports/', import.meta.url));

/** A session name is a directory name: keep it filesystem-safe. */
function sanitizeSession(session: string): string {
  const clean = session.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean === '' ? 'default' : clean.slice(0, 64);
}

export type ArtifactRecord = {
  id: string;
  session: string;
  file: string;
  sidecar: string;
  format: 'png';
  width: number;
  height: number;
  sha256: string;
  caption: string;
  altText: string;
  provenance: {
    fn: string;
    start?: string;
    end?: string;
    timeframe: string;
    ltfTimeframe?: string;
    params?: Record<string, number | boolean | string>;
  };
  analysisDigest?: Record<string, unknown>;
  generatedAt: string;
};

export type SessionManifest = {
  session: string;
  createdAt: string;
  artifacts: ArtifactRecord[];
};

export type SaveChartInput = {
  session: string;
  /** Explicit id; auto-allocated (`<fn>_<tf>_<seq>`) when omitted. */
  id?: string;
  rendered: RenderedPng;
  spec: ChartSpec;
  caption: string;
  altText?: string;
  start?: string;
  end?: string;
  ltfTimeframe?: string;
  analysisDigest?: Record<string, unknown>;
};

function sessionDir(session: string): string {
  return join(REPORTS_ROOT, sanitizeSession(session));
}

function readManifest(dir: string, session: string): SessionManifest {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) return { session, createdAt: new Date().toISOString(), artifacts: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as SessionManifest;
}

/** Allocate the next sequential id for a fn/timeframe pair. */
function nextId(manifest: SessionManifest, base: string): string {
  let seq = 1;
  const taken = new Set(manifest.artifacts.map((a) => a.id));
  while (taken.has(`${base}_${String(seq).padStart(2, '0')}`)) seq++;
  return `${base}_${String(seq).padStart(2, '0')}`;
}

/**
 * Persist a rendered chart + sidecar and update the session manifest.
 * Returns the record that was written (it is what `/api/artifacts`
 * serves and what report assembly should quote).
 */
export function saveChart(input: SaveChartInput): ArtifactRecord {
  const dir = sessionDir(input.session);
  mkdirSync(dir, { recursive: true });
  const manifest = readManifest(dir, sanitizeSession(input.session));

  const fn = input.spec.meta.provenance?.fn ?? 'chart';
  const base = `${fn}_${input.spec.meta.timeframe}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const id = input.id != null && input.id !== '' ? input.id : nextId(manifest, base);

  const pngName = `${id}.png`;
  const jsonName = `${id}.json`;
  writeFileSync(join(dir, pngName), input.rendered.png);

  const record: ArtifactRecord = {
    id,
    session: sanitizeSession(input.session),
    file: pngName,
    sidecar: jsonName,
    format: 'png',
    width: input.rendered.width,
    height: input.rendered.height,
    sha256: createHash('sha256').update(input.rendered.png).digest('hex'),
    caption: input.caption,
    altText: input.altText ?? input.caption,
    provenance: {
      fn,
      start: input.start,
      end: input.end,
      timeframe: input.spec.meta.timeframe,
      ltfTimeframe: input.ltfTimeframe,
      params: input.spec.meta.provenance?.params,
    },
    analysisDigest: input.analysisDigest,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, jsonName), JSON.stringify(record, null, 2) + '\n');

  manifest.artifacts.push(record);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return record;
}

/** All sessions with their manifests (empty artifacts array on read errors). */
export function listArtifacts(): Array<SessionManifest> {
  if (!existsSync(REPORTS_ROOT)) return [];
  return readdirSync(REPORTS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return readManifest(join(REPORTS_ROOT, e.name), e.name);
      } catch {
        return { session: e.name, createdAt: '', artifacts: [] };
      }
    })
    .filter((m) => m.artifacts.length > 0);
}

/** Absolute path of an artifact file inside a session (traversal-safe). */
export function artifactPath(session: string, file: string): string | null {
  const safe = /^[\w.-]+$/.test(file) ? file : null;
  if (safe == null) return null;
  const path = join(sessionDir(session), safe);
  return existsSync(path) ? path : null;
}
