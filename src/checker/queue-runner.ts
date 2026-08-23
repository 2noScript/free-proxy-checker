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

export class QueueRunner {
  private isRunning = false;
  private progressListeners = new Set<(progress: { checked: number; total: number; live: number; dead: number }) => void>();

  subscribeProgress(cb: (progress: { checked: number; total: number; live: number; dead: number }) => void) {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  private notifyProgress(progress: { checked: number; total: number; live: number; dead: number }) {
    for (const cb of this.progressListeners) {
      try {
        cb(progress);
      } catch {}
    }
  }

  /**
   * Run concurrent batch verification with controlled concurrency limit
   */
  async runBatch(items: CheckQueueItem[], concurrency = APP_CONFIG.CONCURRENCY_LIMIT): Promise<{ liveCount: number; deadCount: number }> {
    if (items.length === 0) return { liveCount: 0, deadCount: 0 };

    this.isRunning = true;
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
            this.notifyProgress({ checked, total, live: liveCount, dead: deadCount });
          }
        } catch (err) {
          deadCount++;
          checked++;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);

    this.isRunning = false;
    this.notifyProgress({ checked, total, live: liveCount, dead: deadCount });

    return { liveCount, deadCount };
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}

export const queueRunner = new QueueRunner();
