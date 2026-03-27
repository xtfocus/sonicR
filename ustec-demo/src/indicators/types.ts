import type { UTCTimestamp } from 'lightweight-charts';

export type IndicatorId = string;

export interface IndicatorController {
  id: IndicatorId;
  setEnabled(enabled: boolean): void;
  onTimeframe(intervalSeconds: number): void;
  onReplayFrame(intervalSeconds: number, currentTime: UTCTimestamp | null): void;
}

