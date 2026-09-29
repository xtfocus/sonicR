/**
 * Case artifacts — self-contained analysis folders under `cases/`.
 *
 * A **case** is one investigation (e.g. "aug-2025-long"): every input
 * and output needed to reproduce or reference it lives in one folder.
 *
 * ```
 * cases/<case-id>/
 *   case.json            # the case manifest (below)
 *   data/                # pinned data snippets: exact bars each analysis ran on
 *     bars_1H.csv
 *     bars_5m.csv
 *   analysis/            # raw function outputs, one JSON per fn
 *     signal_1H_5m.json
 *   charts/              # rendered PNGs + sidecars
 *     signal_1H_5m_01.png
 *     signal_1H_5m_01.json
 *   report/
 *     index.html         # LLM-assembled report (optional)
 * ```
 *
 * The case manifest is the LLM's single entry point for report assembly:
 *
 * ```json
 * {
 *   "caseId": "aug-2025-long",
 *   "symbol": "USTEC",
 *   "range": { "start": 1754092800, "end": 1756684800 },
 *   "sourceCsvSha256": "…",           // reproducibility anchor
 *   "bars":  [ { "timeframe": "1H", "file": "data/bars_1H.csv", "from": …, "to": …, "rows": … } ],
 *   "charts": [ ArtifactRecord… ],    // one per PNG+sidecar pair
 *   "analysis": [ { "fn": "signal", "file": "analysis/signal_1H_5m.json" } ]
 * }
 * ```
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { OhlcvBar } from '../analysis/types';
import type { ChartSpec } from '../viz/types';
import type { RenderedPng } from '../viz/png';

export const CASES_ROOT = fileURLToPath(new URL('../../cases/', import.meta.url));

/** A case id is a directory name: keep it filesystem-safe. */
export function sanitizeCase(caseId: string): string {
  const clean = caseId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean === '' ? 'default' : clean.slice(0, 64);
}

export type ArtifactRecord = {
  id: string;
  caseId: string;
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

export type CaseBarsFile = {
  timeframe: string;
  file: string;
  from: number;
  to: number;
  rows: number;
};

export type CaseAnalysisFile = {
  fn: string;
  file: string;
};

export type CaseManifest = {
  caseId: string;
  symbol?: string;
  title?: string;
  range?: { start?: number; to?: number };
  sourceCsvSha256?: string;
  bars: CaseBarsFile[];
  charts: ArtifactRecord[];
  analysis: CaseAnalysisFile[];
  createdAt: string;
};

export type SaveChartInput = {
  caseId: string;
  /** Explicit chart id; auto-allocated (`<fn>_<tf>_<seq>`) when omitted. */
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

function caseDir(caseId: string): string {
  return join(CASES_ROOT, sanitizeCase(caseId));
}

/** Absolute path of a case directory (creates nothing). */
export function caseDirPath(caseId: string): string {
  return caseDir(caseId);
}

/** The parsed case manifest (empty shell when the case has none yet). */
export function readCaseManifest(caseId: string): CaseManifest {
  return readManifest(caseDir(caseId), sanitizeCase(caseId));
}

function chartDir(caseId: string): string {
  return join(caseDir(caseId), 'charts');
}

function readManifest(dir: string, caseId: string): CaseManifest {
  const path = join(dir, 'case.json');
  if (!existsSync(path)) return { caseId, bars: [], charts: [], analysis: [], createdAt: new Date().toISOString() };
  return JSON.parse(readFileSync(path, 'utf8')) as CaseManifest;
}

function writeManifest(manifest: CaseManifest): void {
  writeFileSync(join(caseDir(manifest.caseId), 'case.json'), JSON.stringify(manifest, null, 2) + '\n');
}

/** Allocate the next sequential chart id for a fn/timeframe pair. */
function nextChartId(manifest: CaseManifest, base: string): string {
  let seq = 1;
  const taken = new Set(manifest.charts.map((c) => c.id));
  while (taken.has(`${base}_${String(seq).padStart(2, '0')}`)) seq++;
  return `${base}_${String(seq).padStart(2, '0')}`;
}

/** Persist a rendered chart + sidecar; returns the record that was written. */
export function saveChart(input: SaveChartInput): ArtifactRecord {
  const dir = chartDir(input.caseId);
  mkdirSync(dir, { recursive: true });
  const manifest = readManifest(caseDir(input.caseId), sanitizeCase(input.caseId));

  const fn = input.spec.meta.provenance?.fn ?? 'chart';
  const base = `${fn}_${input.spec.meta.timeframe}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const id = input.id != null && input.id !== '' ? input.id : nextChartId(manifest, base);

  const pngName = `${id}.png`;
  const jsonName = `${id}.json`;
  writeFileSync(join(dir, pngName), input.rendered.png);

  const record: ArtifactRecord = {
    id,
    caseId: sanitizeCase(input.caseId),
    file: `charts/${pngName}`,
    sidecar: `charts/${jsonName}`,
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

  manifest.charts.push(record);
  writeManifest(manifest);
  return record;
}

/**
 * Pin a data snippet: the exact bars a timeframe query ran on, stored as
 * a CSV under `data/` and referenced from the manifest. Keeps every
 * chart in the case recomputable even after the source feed updates.
 */
export function saveCaseBars(caseId: string, timeframe: string, bars: OhlcvBar[], csv: string): CaseBarsFile {
  const dir = join(caseDir(caseId), 'data');
  mkdirSync(dir, { recursive: true });
  const manifest = readManifest(caseDir(caseId), sanitizeCase(caseId));

  const file = `bars_${timeframe.replace(/[^a-zA-Z0-9._-]/g, '')}.csv`;
  writeFileSync(join(dir, file), csv);

  const entry: CaseBarsFile = {
    timeframe,
    file: `data/${file}`,
    from: bars[0]?.time ?? 0,
    to: bars[bars.length - 1]?.time ?? 0,
    rows: bars.length,
  };
  manifest.bars = manifest.bars.filter((b) => b.timeframe !== timeframe); // one per timeframe per case
  manifest.bars.push(entry);
  writeManifest(manifest);
  return entry;
}

/** Store a raw analysis output (used by the CLI / HTTP when saving). */
export function saveCaseAnalysis(caseId: string, fn: string, payload: unknown): CaseAnalysisFile {
  const dir = join(caseDir(caseId), 'analysis');
  mkdirSync(dir, { recursive: true });
  const manifest = readManifest(caseDir(caseId), sanitizeCase(caseId));

  const file = `${fn.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`;
  writeFileSync(join(dir, file), JSON.stringify(payload, null, 2) + '\n');

  manifest.analysis = manifest.analysis.filter((a) => a.fn !== fn);
  manifest.analysis.push({ fn, file: `analysis/${file}` });
  writeManifest(manifest);
  return { fn, file: `analysis/${file}` };
}

/** Stamp the reproducibility anchor (source CSV hash) onto a case. */
export function setCaseSourceHash(caseId: string, sourceCsvSha256: string): void {
  const manifest = readManifest(caseDir(caseId), sanitizeCase(caseId));
  manifest.sourceCsvSha256 = sourceCsvSha256;
  writeManifest(manifest);
}

/** All cases with manifests that contain at least one chart. */
export function listCases(): Array<CaseManifest> {
  if (!existsSync(CASES_ROOT)) return [];
  return readdirSync(CASES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return readManifest(join(CASES_ROOT, e.name), e.name);
      } catch {
        return { caseId: e.name, bars: [], charts: [], analysis: [], createdAt: '' };
      }
    })
    .filter((m) => m.charts.length > 0);
}

/**
 * Absolute path of a case file (traversal-safe: `file` must be a plain
 * name, path segments decoded from the manifest's own entries).
 */
export function caseFilePath(caseId: string, sub: 'charts' | 'data' | 'analysis' | 'report', file: string): string | null {
  const safe = /^[\w.-]+$/.test(file) ? file : null;
  if (safe == null) return null;
  const path = join(caseDir(caseId), sub, safe);
  return existsSync(path) ? path : null;
}