import { describe, expect, it } from 'bun:test';
import { db } from '../src/db';
import type { CheckQueueItem } from '../src/types';

describe('Central Candidate Basket & Deduplication Tests', () => {
  it('should enqueue items and skip duplicates', () => {
    const testItems: CheckQueueItem[] = [
      {
        id: 'http://192.0.2.1:8080',
        ip: '192.0.2.1',
        port: 8080,
        protocol: 'http',
        sourceId: 'test-src-1',
      },
      {
        id: 'http://192.0.2.2:8080',
        ip: '192.0.2.2',
        port: 8080,
        protocol: 'http',
        sourceId: 'test-src-1',
      },
      // Duplicate in same batch
      {
        id: 'http://192.0.2.1:8080',
        ip: '192.0.2.1',
        port: 8080,
        protocol: 'http',
        sourceId: 'test-src-2',
      },
    ];

    const result1 = db.enqueueCandidates(testItems);
    expect(result1.enqueued).toBe(2);
    expect(result1.dedupSkipped).toBe(1);

    // Enqueue again -> should be skipped because both are already in queue
    const result2 = db.enqueueCandidates([testItems[0]!]);
    expect(result2.enqueued).toBe(0);
    expect(result2.dedupSkipped).toBe(1);

    // Dequeue batch
    const dequeued = db.dequeueCandidates(10);
    expect(dequeued.length).toBeGreaterThanOrEqual(2);

    // Clean up
    db.removeCandidates(['http://192.0.2.1:8080', 'http://192.0.2.2:8080']);
  });

  it('should skip candidates recently tested within 3-minute cooldown', () => {
    const testId = 'socks5://198.51.100.1:1080';

    // Simulate proxy record checked right now
    db.updateCheckResult({
      id: testId,
      ip: '198.51.100.1',
      port: 1080,
      protocol: 'socks5',
      isAlive: false,
      latencyMs: 0,
      error: 'Simulated failure',
    });

    // Try enqueuing it immediately
    const res = db.enqueueCandidates([
      {
        id: testId,
        ip: '198.51.100.1',
        port: 1080,
        protocol: 'socks5',
        sourceId: 'test-cooldown',
      },
    ]);

    expect(res.enqueued).toBe(0);
    expect(res.dedupSkipped).toBe(1);

    // Clean up test proxy from DB
    db.deleteProxy(testId);
  });
});
