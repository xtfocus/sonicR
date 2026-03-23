export type IndicatorId = string;

export interface IndicatorController {
  id: IndicatorId;
  setEnabled(enabled: boolean): void;
  onTimeframe(intervalSeconds: number): void;
}

