import type { UTCTimestamp } from 'lightweight-charts';
import type { IndicatorController } from './types';

export class IndicatorManager {
  private _controllers: IndicatorController[];

  constructor(controllers: IndicatorController[]) {
    this._controllers = controllers;
  }

  setEnabled(id: string, enabled: boolean) {
    for (const c of this._controllers) {
      if (c.id === id) c.setEnabled(enabled);
    }
  }

  onTimeframeChanged(intervalSeconds: number) {
    for (const c of this._controllers) {
      c.onTimeframe(intervalSeconds);
    }
  }

  onReplayFrame(intervalSeconds: number, currentTime: UTCTimestamp | null) {
    for (const c of this._controllers) {
      c.onReplayFrame(intervalSeconds, currentTime);
    }
  }
}

