import { APP_CONFIG } from '../config';
import { db } from '../db';
import { ingestionRunner, maintenanceRunner } from '../checker/queue-runner';
import { sourceFetcher } from '../sources/source-fetcher';
import type { ProxySourceConfig } from '../types';

export class PyramidScheduler {
  private sources: ProxySourceConfig[] = [];

  // Stream 1: Source Ingestion State
  private isIngestionRunning = false;
  private activeIngestionTask: string | null = null;
  private ingestionTimer: Timer | null = null;

  // Stream 2: 3-Min Live Pool Maintenance State
  private isMaintenanceRunning = false;
  private activeMaintenanceTask: string | null = null;
  private maintenanceTimer: Timer | null = null;
  private lastMaintenanceRunAt?: string;
  private nextMaintenanceRunAt?: string;

  constructor() {
    this.sources = db.getSources();
    const now = Date.now();

    for (const src of this.sources) {
      if (!src.nextFetchAt || Number.isNaN(new Date(src.nextFetchAt).getTime())) {
        src.nextFetchAt = new Date(now).toISOString();
        db.updateSource(src.id, { nextFetchAt: src.nextFetchAt });
      }
      if (src.lastFetchedCount === undefined) {
        src.lastFetchedCount = 0;
      }
    }

    this.nextMaintenanceRunAt = new Date(now + APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES * 60 * 1000).toISOString();
  }

  start() {
    console.log('⏱️ [Pyramid Scheduler] Initializing Dual-Stream Parallel Engine...');
    console.log('⚡ Stream 1: Ingestion Loop (Every 5s tick)');
    console.log('🔄 Stream 2: Maintenance Loop (Dedicated 3-Min Live Pool interval)');

    // 1. Ingestion Loop (Every 5 seconds)
    this.ingestionTimer = setInterval(() => {
      this.tickIngestion();
    }, 5000);

    // 2. Maintenance Loop (Every 5 seconds check due time)
    this.maintenanceTimer = setInterval(() => {
      this.tickMaintenance();
    }, 5000);

    // Initial immediate ticks
    setTimeout(() => this.tickIngestion(), 1000);
    setTimeout(() => this.tickMaintenance(), 2000);
  }

  stop() {
    if (this.ingestionTimer) {
      clearInterval(this.ingestionTimer);
      this.ingestionTimer = null;
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }

  // =========================================================================
  // STREAM 1: SOURCE INGESTION & CANDIDATE SCREENING
  // =========================================================================

  async tickIngestion() {
    if (this.isIngestionRunning || ingestionRunner.getIsRunning()) {
      return;
    }

    this.sources = db.getSources();
    const now = Date.now();

    const dueSources = this.sources
      .filter((s) => s.enabled && (!s.nextFetchAt || now >= new Date(s.nextFetchAt).getTime()))
      .sort((a, b) => {
        const timeA = a.nextFetchAt ? new Date(a.nextFetchAt).getTime() : 0;
        const timeB = b.nextFetchAt ? new Date(b.nextFetchAt).getTime() : 0;
        return timeA - timeB;
      });

    if (dueSources.length > 0 && dueSources[0]) {
      const targetSource = dueSources[0];
      await this.triggerSourceIngestion(targetSource);
    }
  }

  async triggerSourceIngestion(source: ProxySourceConfig) {
    if (this.isIngestionRunning) return;
    this.isIngestionRunning = true;
    this.activeIngestionTask = `Ingestion: ${source.name}`;

    console.log(`🚀 [Ingestion Cycle] Starting source [${source.name}] (Interval: ${source.fetchIntervalMinutes}m)...`);

    try {
      const rawItems = await sourceFetcher.fetchSource(source);
      source.lastFetchedCount = rawItems.length;
      source.lastFetchedAt = new Date().toISOString();

      db.updateSource(source.id, {
        lastFetchedCount: source.lastFetchedCount,
        lastFetchedAt: source.lastFetchedAt,
      });

      if (rawItems.length > 0) {
        db.batchUpsertRawProxies(rawItems);

        console.log(`🧪 [Screening Tier] Verifying ${rawItems.length} candidate proxies from [${source.name}]...`);
        const { liveCount, deadCount } = await ingestionRunner.runBatch(
          rawItems,
          APP_CONFIG.CONCURRENCY_LIMIT,
          `Screening: ${source.name}`
        );
        console.log(`✅ [Screening Tier Done] [${source.name}]: ${liveCount} Live | ${deadCount} Dead`);

        // Automatically purge dead candidate proxies
        const pruned = db.pruneDeadProxies();
        if (pruned > 0) {
          console.log(`🧹 [Auto-Prune] Purged ${pruned} dead candidate proxies from DB.`);
        }
      }
    } catch (err: any) {
      console.error(`❌ [Ingestion Error] [${source.name}]:`, err?.message || err);
    } finally {
      const finishTime = Date.now();
      source.nextFetchAt = new Date(finishTime + source.fetchIntervalMinutes * 60 * 1000).toISOString();

      db.updateSource(source.id, {
        nextFetchAt: source.nextFetchAt,
        lastFetchedCount: source.lastFetchedCount,
        lastFetchedAt: source.lastFetchedAt,
      });

      this.sources = db.getSources();
      this.isIngestionRunning = false;
      this.activeIngestionTask = null;
    }
  }

  // =========================================================================
  // STREAM 2: 3-MINUTE LIVE POOL MAINTENANCE (RE-CHECK VERIFIED PROXIES)
  // =========================================================================

  async tickMaintenance() {
    if (this.isMaintenanceRunning || maintenanceRunner.getIsRunning()) {
      return;
    }

    const now = Date.now();
    const nextMaint = this.nextMaintenanceRunAt ? new Date(this.nextMaintenanceRunAt).getTime() : 0;
    if (now >= nextMaint) {
      await this.triggerMaintenanceCycle();
    }
  }

  async triggerMaintenanceCycle() {
    if (this.isMaintenanceRunning) return;
    this.isMaintenanceRunning = true;
    this.activeMaintenanceTask = '3-Min Maintenance';

    const now = new Date();
    this.lastMaintenanceRunAt = now.toISOString();

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

        const { liveCount, deadCount } = await maintenanceRunner.runBatch(
          queueItems,
          APP_CONFIG.CONCURRENCY_LIMIT,
          '3-Min Maintenance'
        );
        console.log(`🏁 [Maintenance Done] ${liveCount} still Live | ${deadCount} Failed/Pruned`);

        // Automatically purge dead proxies from SQLite DB
        const pruned = db.pruneDeadProxies();
        if (pruned > 0) {
          console.log(`🧹 [Auto-Prune] Permanently deleted ${pruned} dead proxies from DB.`);
        }
      }
    } catch (err: any) {
      console.error(`❌ [Maintenance Error]:`, err?.message || err);
    } finally {
      this.nextMaintenanceRunAt = new Date(Date.now() + APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES * 60 * 1000).toISOString();
      this.isMaintenanceRunning = false;
      this.activeMaintenanceTask = null;
    }
  }

  // =========================================================================
  // SOURCES & STATUS ACCESSORS
  // =========================================================================

  getSources(): ProxySourceConfig[] {
    this.sources = db.getSources();
    return this.sources;
  }

  addSource(source: ProxySourceConfig) {
    source.nextFetchAt = new Date().toISOString();
    source.lastFetchedCount = 0;
    db.insertSource(source);
    this.sources = db.getSources();
  }

  updateSource(id: string, updates: Partial<ProxySourceConfig>): boolean {
    const success = db.updateSource(id, updates);
    if (success) {
      this.sources = db.getSources();
    }
    return success;
  }

  deleteSource(id: string): boolean {
    const success = db.deleteSource(id);
    if (success) {
      this.sources = db.getSources();
    }
    return success;
  }

  getStatus() {
    return {
      ingestion: {
        isRunning: this.isIngestionRunning || ingestionRunner.getIsRunning(),
        activeTask: this.activeIngestionTask || ingestionRunner.getCurrentJobName() || null,
      },
      maintenance: {
        intervalMinutes: APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES,
        lastRunAt: this.lastMaintenanceRunAt,
        nextRunAt: this.nextMaintenanceRunAt,
        isRunning: this.isMaintenanceRunning || maintenanceRunner.getIsRunning(),
        activeTask: this.activeMaintenanceTask || maintenanceRunner.getCurrentJobName() || null,
      },
    };
  }

  getMaintenanceStatus() {
    return this.getStatus().maintenance;
  }
}

export const scheduler = new PyramidScheduler();
