/**
 * Shared case writer — the single path that turns a chart outcome into a
 * persisted case entry (used by the chart CLI, the HTTP server and the
 * report driver, so every surface pins data identically).
 *
 * Steps, in order:
 *
 * 1. Render the spec → PNG.
 * 2. Pin the exact bars the analysis ran on (`data/bars_<tf>.csv`, incl.
 *    the LTF trigger series for `signal`).
 * 3. Snapshot the raw analysis output (`analysis/<fn>.json`).
 * 4. Stamp the source-CSV hash (reproducibility anchor).
 * 5. Save chart + sidecar (`charts/<id>.png` + `.json`).
 */

import type { ChartOutcome } from './chart-core';
import {
  saveCaseAnalysis,
  saveCaseBars,
  saveChart,
  setCaseSourceHash,
  type ArtifactRecord,
} from './artifacts';
import { sourceCsvSha256 } from './dataset';
import { barsToCsv } from '../data-export';
import { renderPng } from '../viz/png';

export type PersistChartOutcomeInput = {
  caseId: string;
  outcome: ChartOutcome;
  /** Analysis fn id (for the analysis/ snapshot); omitted for custom specs. */
  fn?: string | null;
  start?: string;
  end?: string;
  ltfTimeframe?: string;
  csvPath?: string;
};

/** Render + pin data/analysis + save chart into the case; returns the artifact record. */
export function persistChartOutcome(input: PersistChartOutcomeInput): ArtifactRecord {
  const { caseId, outcome, fn, start, end, ltfTimeframe } = input;
  const rendered = renderPng(outcome.spec);

  saveCaseBars(caseId, outcome.spec.meta.timeframe, outcome.bars, barsToCsv(outcome.bars));
  if (outcome.ltfBars != null && ltfTimeframe != null) {
    saveCaseBars(caseId, ltfTimeframe, outcome.ltfBars, barsToCsv(outcome.ltfBars));
  }
  if (fn != null && fn !== '') {
    saveCaseAnalysis(caseId, fn, outcome.signal ?? { fn, caption: outcome.caption });
  }
  setCaseSourceHash(caseId, sourceCsvSha256(input.csvPath));

  return saveChart({
    caseId,
    rendered,
    spec: outcome.spec,
    caption: outcome.caption,
    start,
    end,
    ltfTimeframe,
    analysisDigest: outcome.signal
      ? {
          bias: outcome.signal.bias,
          pois: outcome.signal.pois.length,
          signals: outcome.signal.signals,
        }
      : undefined,
  });
}