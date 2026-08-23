import { APP_CONFIG } from '../config';
import { db } from '../db';
import { queueRunner } from '../checker/queue-runner';
import { sourceFetcher } from '../sources/source-fetcher';
import type { ProxySourceConfig } from '../types';

export class PyramidScheduler {
  private sources: ProxySourceConfig[] = [];
  private isMaintenanceRunning = false;
  private isSourceIngestionRunning = false;
  private timer: Timer | null = null;
  private lastMaintenanceRunAt?: string;
  private nextMaintenanceRunAt?: string;

  constructor() {
    this.sources = APP_CONFIG.loadSources();
    const now = Date.now();
    for (const src of this.sources) {
      // Trigger initial fetch immediately on startup
      src.nextFetchAt = new Date(now).toISOString();
      src.lastFetchedCount = 0;
    }
    this.nextMaintenanceRunAt = new Date(now + APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES * 60 * 1000).toISOString();
  }

  start() {
    console.log('⏱️ [Pyramid Scheduler] Initializing Multi-Source & 3-Min Maintenance Timers...');

    // Run master loop tick every 10 seconds
    this.timer = setInterval(() => {
      this.tick();
    }, 10000);

    // Initial immediate tick
    setTimeout(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    const now = Date.now();

    // 1. Check if any Source is due for Ingestion (e.g. 15m, 30m...)
    if (!this.isSourceIngestionRunning) {
      for (const src of this.sources) {
        if (!src.enabled) continue;
        const nextTime = src.nextFetchAt ? new Date(src.nextFetchAt).getTime() : 0;

        if (now >= nextTime) {
          this.triggerSourceIngestion(src);
          break; // Process one source at a time
        }
      }
    }

    // 2. Check if Maintenance Cycle is due (Every 3 minutes)
    if (!this.isMaintenanceRunning) {
      const nextMaint = this.nextMaintenanceRunAt ? new Date(this.nextMaintenanceRunAt).getTime() : 0;
      if (now >= nextMaint) {
        this.triggerMaintenanceCycle();
      }
    }
  }

  /**
   * Tầng 1 & 2: Ingestion & Initial Fast Screening from Source
   */
  async triggerSourceIngestion(source: ProxySourceConfig) {
    this.isSourceIngestionRunning = true;
    const now = new Date();
    source.lastFetchedAt = now.toISOString();
    source.nextFetchAt = new Date(now.getTime() + source.fetchIntervalMinutes * 60 * 1000).toISOString();

    console.log(`🚀 [Ingestion Cycle] Triggering source [${source.name}] (Interval: ${source.fetchIntervalMinutes}m)...`);

    try {
      const rawItems = await sourceFetcher.fetchSource(source);
      source.lastFetchedCount = rawItems.length;

      if (rawItems.length > 0) {
        // Save initial candidates to DB
        db.batchUpsertRawProxies(rawItems);

        // Run Screening verification batch
        console.log(`🧪 [Screening Tier] Verifying ${rawItems.length} candidate proxies from [${source.name}]...`);
        const { liveCount, deadCount } = await queueRunner.runBatch(rawItems, APP_CONFIG.CONCURRENCY_LIMIT);
        console.log(`✅ [Screening Tier Done] [${source.name}]: ${liveCount} Live | ${deadCount} Dead`);
      }
    } catch (err: any) {
      console.error(`❌ [Ingestion Error] [${source.name}]:`, err?.message || err);
    } finally {
      this.isSourceIngestionRunning = false;
    }
  }

  /**
   * Tầng 3: 3-Minute Maintenance Cycle (Re-checks only Verified Live proxies)
   */
  async triggerMaintenanceCycle() {
    this.isMaintenanceRunning = true;
    const now = new Date();
    this.lastMaintenanceRunAt = now.toISOString();
    this.nextMaintenanceRunAt = new Date(now.getTime() + APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES * 60 * 1000).toISOString();

    console.log(`\n🏆 ========================================================`);
    console.log(`🏆 [3-Min Maintenance] Starting Re-verification of Live Pool...`);
    console.log(`🏆 ========================================================`);

    try {
      const liveProxies = db.getLiveProxies();
      console.log(`🔍 [Live Pool] Found ${liveProxies.length} active proxies to re-verify.`);

      if (liveProxies.length > 0) {
        const queueItems = liveProxies.map((p) => ({
          id: p.id,
          ip: p.ip,
          port: p.port,
          protocol: p.protocol,
          sourceId: p.sourceId,
        }));

        const { liveCount, deadCount } = await queueRunner.runBatch(queueItems, APP_CONFIG.CONCURRENCY_LIMIT);
        console.log(`🏁 [Maintenance Done] ${liveCount} still Live | ${deadCount} Failed/Pruned`);
      }
    } catch (err: any) {
      console.error(`❌ [Maintenance Error]:`, err?.message || err);
    } finally {
      this.isMaintenanceRunning = false;
    }
  }

  getSources(): ProxySourceConfig[] {
    return this.sources;
  }

  addSource(source: ProxySourceConfig) {
    source.nextFetchAt = new Date().toISOString();
    source.lastFetchedCount = 0;
    this.sources.push(source);
    APP_CONFIG.saveSources(this.sources);
  }

  getMaintenanceStatus() {
    return {
      intervalMinutes: APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES,
      lastRunAt: this.lastMaintenanceRunAt,
      nextRunAt: this.nextMaintenanceRunAt,
      isChecking: this.isMaintenanceRunning || queueRunner.getIsRunning(),
    };
  }
}

export const scheduler = new PyramidScheduler();
