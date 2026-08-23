import { Database as SqliteDatabase } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { APP_CONFIG } from './config';
import type { CheckResult, GeoInfo, ProxyRecord, ProxyStatus } from './types';

export class DatabaseManager {
  private db: SqliteDatabase | null = null;

  constructor() {
    this.init();
  }

  private init() {
    try {
      const dbDir = path.dirname(APP_CONFIG.DB_PATH);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new SqliteDatabase(APP_CONFIG.DB_PATH);
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS proxies (
          id TEXT PRIMARY KEY,
          ip TEXT NOT NULL,
          port INTEGER NOT NULL,
          protocol TEXT NOT NULL,
          status TEXT NOT NULL,
          latency_ms INTEGER DEFAULT 0,
          country_code TEXT DEFAULT 'N/A',
          country_name TEXT DEFAULT 'Unknown',
          flag TEXT DEFAULT '🌐',
          city TEXT DEFAULT '',
          isp TEXT DEFAULT '',
          anonymity TEXT DEFAULT 'unknown',
          source_id TEXT DEFAULT 'manual',
          success_count INTEGER DEFAULT 0,
          fail_count INTEGER DEFAULT 0,
          consecutive_fails INTEGER DEFAULT 0,
          first_seen_at TEXT NOT NULL,
          last_checked_at TEXT NOT NULL,
          last_live_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);
        CREATE INDEX IF NOT EXISTS idx_proxies_protocol ON proxies(protocol);
        CREATE INDEX IF NOT EXISTS idx_proxies_country ON proxies(country_code);
        CREATE INDEX IF NOT EXISTS idx_proxies_latency ON proxies(latency_ms);
      `);

      console.log(`🗄️ [SQLite Database] Connected successfully to ${APP_CONFIG.DB_PATH} (WAL Mode)`);
    } catch (err) {
      console.error('❌ [SQLite Init Error]:', err);
    }
  }

  /**
   * Upsert raw candidate proxy before screening
   */
  upsertRawProxy(proxy: { id: string; ip: string; port: number; protocol: string; sourceId: string }) {
    if (!this.db) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO proxies (
        id, ip, port, protocol, status, source_id, first_seen_at, last_checked_at
      ) VALUES ($id, $ip, $port, $protocol, 'warning', $source_id, $now, $now)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id;
    `);

    stmt.run({
      $id: proxy.id,
      $ip: proxy.ip,
      $port: proxy.port,
      $protocol: proxy.protocol,
      $source_id: proxy.sourceId,
      $now: now,
    });
  }

  /**
   * Batch upsert raw candidates
   */
  batchUpsertRawProxies(proxies: { id: string; ip: string; port: number; protocol: string; sourceId: string }[]) {
    if (!this.db || proxies.length === 0) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO proxies (
        id, ip, port, protocol, status, source_id, first_seen_at, last_checked_at
      ) VALUES ($id, $ip, $port, $protocol, 'warning', $source_id, $now, $now)
      ON CONFLICT(id) DO NOTHING;
    `);

    this.db.transaction(() => {
      for (const p of proxies) {
        stmt.run({
          $id: p.id,
          $ip: p.ip,
          $port: p.port,
          $protocol: p.protocol,
          $source_id: p.sourceId,
          $now: now,
        });
      }
    })();
  }

  /**
   * Update proxy after check result
   */
  updateCheckResult(result: CheckResult, geo?: GeoInfo) {
    if (!this.db) return;

    const now = new Date().toISOString();
    const existing = this.getProxyById(result.id);

    let status: ProxyStatus = result.isAlive ? 'live' : 'dead';
    let consecutiveFails = result.isAlive ? 0 : (existing?.consecutiveFails || 0) + 1;
    let successCount = (existing?.successCount || 0) + (result.isAlive ? 1 : 0);
    let failCount = (existing?.failCount || 0) + (result.isAlive ? 0 : 1);
    let lastLiveAt = result.isAlive ? now : existing?.lastLiveAt;

    if (!result.isAlive && consecutiveFails < APP_CONFIG.MAX_CONSECUTIVE_FAILS) {
      status = 'warning'; // 1 fail is warning, >= 2 is dead
    }

    const countryCode = geo?.countryCode || existing?.countryCode || 'N/A';
    const countryName = geo?.countryName || existing?.countryName || 'Unknown';
    const flag = geo?.flag || existing?.flag || '🌐';
    const city = geo?.city || existing?.city || '';
    const isp = geo?.isp || existing?.isp || '';
    const anonymity = result.anonymity || existing?.anonymity || 'unknown';

    const stmt = this.db.prepare(`
      INSERT INTO proxies (
        id, ip, port, protocol, status, latency_ms, country_code, country_name, flag,
        city, isp, anonymity, source_id, success_count, fail_count, consecutive_fails,
        first_seen_at, last_checked_at, last_live_at
      ) VALUES (
        $id, $ip, $port, $protocol, $status, $latency_ms, $country_code, $country_name, $flag,
        $city, $isp, $anonymity, 'manual', $success_count, $fail_count, $consecutive_fails,
        $now, $now, $last_live_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        latency_ms = excluded.latency_ms,
        country_code = excluded.country_code,
        country_name = excluded.country_name,
        flag = excluded.flag,
        city = excluded.city,
        isp = excluded.isp,
        anonymity = excluded.anonymity,
        success_count = excluded.success_count,
        fail_count = excluded.fail_count,
        consecutive_fails = excluded.consecutive_fails,
        last_checked_at = excluded.last_checked_at,
        last_live_at = COALESCE(excluded.last_live_at, proxies.last_live_at);
    `);

    stmt.run({
      $id: result.id,
      $ip: result.ip,
      $port: result.port,
      $protocol: result.protocol,
      $status: status,
      $latency_ms: result.latencyMs,
      $country_code: countryCode,
      $country_name: countryName,
      $flag: flag,
      $city: city,
      $isp: isp,
      $anonymity: anonymity,
      $success_count: successCount,
      $fail_count: failCount,
      $consecutive_fails: consecutiveFails,
      $now: now,
      $last_live_at: lastLiveAt || null,
    });
  }

  getProxyById(id: string): ProxyRecord | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as any;
    return row ? this.mapRowToRecord(row) : null;
  }

  /**
   * Get all live proxies (sorted by fastest latency)
   */
  getLiveProxies(filter?: {
    protocol?: string;
    country?: string;
    maxLatency?: number;
    ip?: string;
    search?: string;
    anonymity?: string;
  }): ProxyRecord[] {
    if (!this.db) return [];

    let query = `SELECT * FROM proxies WHERE status = 'live'`;
    const params: any[] = [];

    if (filter?.protocol) {
      query += ` AND protocol = ?`;
      params.push(filter.protocol.toLowerCase());
    }
    if (filter?.country) {
      query += ` AND country_code = ?`;
      params.push(filter.country.toUpperCase());
    }
    if (filter?.ip) {
      query += ` AND ip LIKE ?`;
      params.push(`%${filter.ip}%`);
    }
    if (filter?.anonymity) {
      query += ` AND anonymity = ?`;
      params.push(filter.anonymity.toLowerCase());
    }
    if (filter?.search) {
      query += ` AND (ip LIKE ? OR city LIKE ? OR isp LIKE ? OR id LIKE ?)`;
      const kw = `%${filter.search}%`;
      params.push(kw, kw, kw, kw);
    }
    if (filter?.maxLatency) {
      query += ` AND latency_ms <= ?`;
      params.push(filter.maxLatency);
    }

    query += ` ORDER BY latency_ms ASC, last_live_at DESC;`;

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapRowToRecord(r));
  }

  /**
   * Get all proxies with optional pagination and rich multi-criteria filters
   */
  getAllProxies(filter?: {
    status?: string;
    protocol?: string;
    country?: string;
    ip?: string;
    search?: string;
    maxLatency?: number;
    anonymity?: string;
    limit?: number;
    offset?: number;
  }): ProxyRecord[] {
    if (!this.db) return [];

    let query = 'SELECT * FROM proxies WHERE 1=1';
    const params: any[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.protocol) {
      query += ' AND protocol = ?';
      params.push(filter.protocol.toLowerCase());
    }
    if (filter?.country) {
      query += ' AND country_code = ?';
      params.push(filter.country.toUpperCase());
    }
    if (filter?.ip) {
      query += ' AND ip LIKE ?';
      params.push(`%${filter.ip}%`);
    }
    if (filter?.anonymity) {
      query += ' AND anonymity = ?';
      params.push(filter.anonymity.toLowerCase());
    }
    if (filter?.search) {
      query += ' AND (ip LIKE ? OR city LIKE ? OR isp LIKE ? OR id LIKE ?)';
      const kw = `%${filter.search}%`;
      params.push(kw, kw, kw, kw);
    }
    if (filter?.maxLatency) {
      query += ' AND latency_ms <= ?';
      params.push(filter.maxLatency);
    }

    query += ' ORDER BY status ASC, latency_ms ASC LIMIT ? OFFSET ?;';
    params.push(filter?.limit || 100, filter?.offset || 0);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapRowToRecord(r));
  }

  /**
   * Aggregate statistics
   */
  getStats() {
    if (!this.db) {
      return { total: 0, live: 0, dead: 0, warning: 0, avgLatency: 0, byProtocol: {}, byCountry: {} };
    }

    const totalRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
        SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) as dead,
        SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) as warning,
        AVG(CASE WHEN status = 'live' AND latency_ms > 0 THEN latency_ms ELSE NULL END) as avg_latency
      FROM proxies;
    `).get() as any;

    const protocolRows = this.db.prepare(`
      SELECT protocol, COUNT(*) as count FROM proxies WHERE status = 'live' GROUP BY protocol;
    `).all() as any[];

    const countryRows = this.db.prepare(`
      SELECT country_code, flag, COUNT(*) as count FROM proxies WHERE status = 'live' GROUP BY country_code ORDER BY count DESC LIMIT 15;
    `).all() as any[];

    const byProtocol: Record<string, number> = {};
    for (const r of protocolRows) {
      byProtocol[r.protocol] = r.count;
    }

    const byCountry: Record<string, number> = {};
    for (const r of countryRows) {
      byCountry[`${r.flag} ${r.country_code}`] = r.count;
    }

    return {
      total: totalRow?.total || 0,
      live: totalRow?.live || 0,
      dead: totalRow?.dead || 0,
      warning: totalRow?.warning || 0,
      avgLatency: Math.round(totalRow?.avg_latency || 0),
      byProtocol,
      byCountry,
    };
  }

  private mapRowToRecord(row: any): ProxyRecord {
    return {
      id: row.id,
      ip: row.ip,
      port: row.port,
      protocol: row.protocol,
      status: row.status,
      latencyMs: row.latency_ms,
      countryCode: row.country_code,
      countryName: row.country_name,
      flag: row.flag,
      city: row.city,
      isp: row.isp,
      anonymity: row.anonymity,
      sourceId: row.source_id,
      successCount: row.success_count,
      failCount: row.fail_count,
      consecutiveFails: row.consecutive_fails,
      firstSeenAt: row.first_seen_at,
      lastCheckedAt: row.last_checked_at,
      lastLiveAt: row.last_live_at,
    };
  }
}

export const db = new DatabaseManager();
