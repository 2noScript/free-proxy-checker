import { APP_CONFIG } from '../config';
import { db } from '../db';
import { candidateWorker } from '../checker/candidate-worker';
import { maintenanceRunner } from '../checker/queue-runner';
import { sourceFetcher } from '../sources/source-fetcher';
import type { ProxySourceConfig } from '../types';

export class PyramidScheduler {
  private sources: ProxySourceConfig[] = [];

  // Stream 1: Source Ingestion (Producers)
  private activeFetchingSources = new Set<string>();
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
    console.log('⚡ Stream 1: Producer Fetch Loop (Every 5s tick -> Central Basket)');
    console.log('🔄 Stream 2: Maintenance Loop (Dedicated 3-Min Live Pool interval)');

    // 1. Ingestion / Producer Loop (Every 5 seconds)
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

    // Check if basket has leftover items from previous run
    setTimeout(() => candidateWorker.wakeUp(), 3000);
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
  // STREAM 1: SOURCE INGESTION (PRODUCER) -> CENTRAL CANDIDATE BASKET
  // =========================================================================

  async tickIngestion() {
    this.sources = db.getSources();
    const now = Date.now();

    const dueSources = this.sources.filter(
      (s) => s.enabled && !this.activeFetchingSources.has(s.id) && (!s.nextFetchAt || now >= new Date(s.nextFetchAt).getTime())
    );

    // Each due source fetches independently without blocking any other source
    for (const source of dueSources) {
      this.fetchAndEnqueueSource(source).catch((err) => {
        console.error(`❌ [Ingestion Error] Source [${source.name}]:`, err?.message || err);
      });
    }
  }

  /**
   * Fetch a source and push new valid candidates to central basket
   */
  async fetchAndEnqueueSource(source: ProxySourceConfig) {
    if (this.activeFetchingSources.has(source.id)) return;
    this.activeFetchingSources.add(source.id);

    // Schedule next run immediately based on fetchIntervalMinutes to avoid any drift
    const nextTime = new Date(Date.now() + source.fetchIntervalMinutes * 60 * 1000).toISOString();
    db.updateSource(source.id, { nextFetchAt: nextTime });

    console.log(`📥 [Source Fetcher] Fetching source [${source.name}] (${source.url})...`);

    try {
      const rawItems = await sourceFetcher.fetchSource(source);
      const fetchedCount = rawItems.length;
      const fetchedAt = new Date().toISOString();

      // Enqueue into central basket with smart deduplication & 3m cooldown filter
      const { enqueued, dedupSkipped } = db.enqueueCandidates(rawItems);

      db.updateSource(source.id, {
        lastFetchedCount: fetchedCount,
        lastFetchedAt: fetchedAt,
      });

      console.log(
        `✅ [Basket Harvest] [${source.name}]: Got ${fetchedCount} | Enqueued ${enqueued} to Basket | Skipped ${dedupSkipped} (Dedup / Cooldown)`
      );

      // Wake up screening worker if new items arrived
      if (enqueued > 0) {
        candidateWorker.wakeUp();
      }
    } catch (err: any) {
      console.error(`❌ [Fetch Error] [${source.name}]:`, err?.message || err);
    } finally {
      this.activeFetchingSources.delete(source.id);
      this.sources = db.getSources();
    }
  }

  async triggerSourceIngestion(source: ProxySourceConfig) {
    await this.fetchAndEnqueueSource(source);
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
    const workerStatus = candidateWorker.getStatus();
    return {
      ingestion: {
        isRunning: workerStatus.isProcessing,
        activeTask: workerStatus.activeTask,
        queueSize: workerStatus.queueCount,
        dedupSavedTotal: workerStatus.dedupSavedTotal,
        fetchingSources: Array.from(this.activeFetchingSources),
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
