export interface AutomationProgressStats {
  total: number;
  queued: number;
  processing: number;
  done: number;
  failed: number;
  stopped: number;
  finished: number;
  percent: number;
}
