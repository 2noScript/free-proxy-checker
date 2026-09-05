import { APP_CONFIG } from '../config';
import { db } from '../db';
import { ingestionRunner } from './queue-runner';

export class CandidateWorker {
  private isProcessing = false;
  private shouldWakeUp = false;

  /**
   * Wake up the worker if idle, or signal to keep draining if already processing
   */
  wakeUp() {
    if (this.isProcessing) {
      this.shouldWakeUp = true;
      return;
    }

    // Fire & forget async loop
    this.processQueue().catch((err) => {
      console.error('❌ [Candidate Worker Error]:', err);
    });
  }

  /**
   * Main consumer loop: Drains candidates from central basket
   */
  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        this.shouldWakeUp = false;

        const batch = db.dequeueCandidates(APP_CONFIG.SCREENING_BATCH_SIZE);
        if (batch.length === 0) {
          // Basket is empty -> Worker transitions to Idle / Sleeping
          break;
        }

        const totalWaiting = db.getCandidateQueueCount();
        console.log(`🧺 [Central Basket] Worker active: Dequeued ${batch.length} items (${totalWaiting} remaining in basket)...`);

        const { liveCount, deadCount } = await ingestionRunner.runBatch(
          batch,
          APP_CONFIG.CONCURRENCY_LIMIT,
          `Screening Basket (${totalWaiting} waiting)`
        );

        // Remove screened batch from candidate_queue
        db.removeCandidates(batch.map((b) => b.id));

        // Auto prune dead proxies from DB
        const pruned = db.pruneDeadProxies();
        if (pruned > 0) {
          console.log(`🧹 [Auto-Prune] Cleaned ${pruned} dead candidate proxies.`);
        }

        console.log(`✅ [Basket Batch Done] ${liveCount} Live | ${deadCount} Dead`);

        // Check if new items were pushed while screening this batch
        if (this.shouldWakeUp) {
          continue;
        }
      }
    } finally {
      this.isProcessing = false;
      console.log('💤 [Central Basket] Worker finished all items. Transitioned to IDLE (Sleeping).');
    }
  }

  getIsProcessing(): boolean {
    return this.isProcessing;
  }

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      queueCount: db.getCandidateQueueCount(),
      activeTask: this.isProcessing ? (ingestionRunner.getCurrentJobName() || 'Screening Basket') : null,
      dedupSavedTotal: db.getDedupSavedCount(),
    };
  }
}

export const candidateWorker = new CandidateWorker();
