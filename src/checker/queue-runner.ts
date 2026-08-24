import { APP_CONFIG } from '../config';
import { db } from '../db';
import { geoService } from '../services/geoip.service';
import type { CheckResult, ProxyProtocol } from '../types';
import { socketChecker } from './socket-checker';

export interface CheckQueueItem {
  id: string;
  ip: string;
  port: number;
  protocol: ProxyProtocol;
  sourceId: string;
}

export interface QueueProgressEvent {
  stream?: 'ingest' | 'maint';
  jobName?: string;
  checked: number;
  total: number;
  live: number;
  dead: number;
}

export class QueueRunner {
  private isRunning = false;
  private currentJobName?: string;
  private streamType: 'ingest' | 'maint';
  private progressListeners = new Set<(progress: QueueProgressEvent) => void>();

  constructor(streamType: 'ingest' | 'maint' = 'ingest') {
    this.streamType = streamType;
  }

  subscribeProgress(cb: (progress: QueueProgressEvent) => void) {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  private notifyProgress(progress: QueueProgressEvent) {
    for (const cb of this.progressListeners) {
      try {
        cb(progress);
      } catch {}
    }
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getCurrentJobName(): string | undefined {
    return this.currentJobName;
  }

  getStreamType(): 'ingest' | 'maint' {
    return this.streamType;
  }

  /**
   * Run concurrent batch verification with controlled concurrency limit
   */
  async runBatch(
    items: CheckQueueItem[],
    concurrency = APP_CONFIG.CONCURRENCY_LIMIT,
    jobName?: string
  ): Promise<{ liveCount: number; deadCount: number }> {
    if (items.length === 0) return { liveCount: 0, deadCount: 0 };

    this.isRunning = true;
    this.currentJobName = jobName;
    let checked = 0;
    let liveCount = 0;
    let deadCount = 0;
    const total = items.length;

    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const item = items[index++];
        if (!item) break;

        try {
          const result: CheckResult = await socketChecker.check(item);
          let geo;
          if (result.isAlive) {
            liveCount++;
            geo = await geoService.lookup(item.ip);
          } else {
            deadCount++;
          }

          // Real-time atomic update to SQLite
          db.updateCheckResult(result, geo);
          checked++;

          if (checked % 5 === 0 || checked === total) {
            this.notifyProgress({
              stream: this.streamType,
              jobName: this.currentJobName,
              checked,
              total,
              live: liveCount,
              dead: deadCount,
            });
          }
        } catch (err) {
          deadCount++;
          checked++;
        }
      }
    };

    try {
      const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
      await Promise.all(workers);
    } finally {
      this.isRunning = false;
      this.currentJobName = undefined;
    }

    this.notifyProgress({
      stream: this.streamType,
      jobName,
      checked,
      total,
      live: liveCount,
      dead: deadCount,
    });

    return { liveCount, deadCount };
  }
}

export const ingestionRunner = new QueueRunner('ingest');
export const maintenanceRunner = new QueueRunner('maint');
export const queueRunner = ingestionRunner;
