import { Database as SqliteDatabase } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { APP_CONFIG, DEFAULT_SOURCES } from './config';
import type { CheckResult, GeoInfo, ProxyRecord, ProxySourceConfig, ProxyStatus } from './types';

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

        CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          format TEXT DEFAULT 'text_lines',
          default_protocol TEXT,
          fetch_interval_minutes INTEGER DEFAULT 15,
          enabled INTEGER DEFAULT 1,
          headers TEXT DEFAULT '{}',
          last_fetched_at TEXT,
          next_fetch_at TEXT,
          last_fetched_count INTEGER DEFAULT 0
        );
      `);

      // Auto-seed DEFAULT_SOURCES into SQLite if not already present
      const insertSourceStmt = this.db.prepare(`
        INSERT OR IGNORE INTO sources (
          id, name, url, format, default_protocol, fetch_interval_minutes, enabled, next_fetch_at, last_fetched_count
        ) VALUES (
          $id, $name, $url, $format, $default_protocol, $fetch_interval_minutes, $enabled, $next_fetch_at, 0
        );
      `);

      const now = new Date().toISOString();
      for (const def of DEFAULT_SOURCES) {
        insertSourceStmt.run({
          $id: def.id,
          $name: def.name,
          $url: def.url,
          $format: def.format || 'text_lines',
          $default_protocol: def.defaultProtocol || null,
          $fetch_interval_minutes: def.fetchIntervalMinutes || 15,
          $enabled: def.enabled !== false ? 1 : 0,
          $next_fetch_at: now,
        });
      }

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
   * Permanently purge all dead proxies from SQLite database
   */
  pruneDeadProxies(): number {
    if (!this.db) return 0;
    const res = this.db.prepare("DELETE FROM proxies WHERE status = 'dead'").run();
    return res.changes;
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
    sourceId?: string;
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
    if (filter?.sourceId) {
      query += ` AND source_id = ?`;
      params.push(filter.sourceId);
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
    sourceId?: string;
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
    if (filter?.sourceId) {
      query += ' AND source_id = ?';
      params.push(filter.sourceId);
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

  // ==========================================
  // Sources Management in SQLite
  // ==========================================

  getSources(): ProxySourceConfig[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM sources ORDER BY id ASC').all() as any[];
    return rows.map((r) => this.mapRowToSource(r));
  }

  getSourceById(id: string): ProxySourceConfig | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as any;
    return row ? this.mapRowToSource(row) : null;
  }

  insertSource(source: ProxySourceConfig): void {
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT INTO sources (
        id, name, url, format, default_protocol, fetch_interval_minutes, enabled, headers, next_fetch_at, last_fetched_count
      ) VALUES (
        $id, $name, $url, $format, $default_protocol, $fetch_interval_minutes, $enabled, $headers, $next_fetch_at, $last_fetched_count
      );
    `);

    stmt.run({
      $id: source.id,
      $name: source.name,
      $url: source.url,
      $format: source.format || 'text_lines',
      $default_protocol: source.defaultProtocol || null,
      $fetch_interval_minutes: source.fetchIntervalMinutes || 15,
      $enabled: source.enabled !== false ? 1 : 0,
      $headers: JSON.stringify(source.headers || {}),
      $next_fetch_at: source.nextFetchAt || new Date().toISOString(),
      $last_fetched_count: source.lastFetchedCount || 0,
    });
  }

  updateSource(id: string, updates: Partial<ProxySourceConfig>): boolean {
    if (!this.db) return false;
    const existing = this.getSourceById(id);
    if (!existing) return false;

    const merged: ProxySourceConfig = {
      ...existing,
      ...updates,
      id: existing.id,
      name: updates.name ?? existing.name,
      url: updates.url ?? existing.url,
      format: updates.format ?? existing.format,
      fetchIntervalMinutes: updates.fetchIntervalMinutes ?? existing.fetchIntervalMinutes,
      enabled: updates.enabled ?? existing.enabled,
    };

    const stmt = this.db.prepare(`
      UPDATE sources SET
        name = $name,
        url = $url,
        format = $format,
        default_protocol = $default_protocol,
        fetch_interval_minutes = $fetch_interval_minutes,
        enabled = $enabled,
        headers = $headers,
        last_fetched_at = $last_fetched_at,
        next_fetch_at = $next_fetch_at,
        last_fetched_count = $last_fetched_count
      WHERE id = $id;
    `);

    stmt.run({
      $id: merged.id,
      $name: merged.name,
      $url: merged.url,
      $format: merged.format || 'text_lines',
      $default_protocol: merged.defaultProtocol || null,
      $fetch_interval_minutes: merged.fetchIntervalMinutes || 15,
      $enabled: merged.enabled ? 1 : 0,
      $headers: JSON.stringify(merged.headers || {}),
      $last_fetched_at: merged.lastFetchedAt || null,
      $next_fetch_at: merged.nextFetchAt || null,
      $last_fetched_count: merged.lastFetchedCount || 0,
    });

    return true;
  }

  deleteSource(id: string): boolean {
    if (!this.db) return false;
    const res = this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private mapRowToSource(row: any): ProxySourceConfig {
    let headers: Record<string, string> | undefined;
    if (row.headers) {
      try {
        headers = JSON.parse(row.headers);
      } catch {
        headers = undefined;
      }
    }

    return {
      id: row.id,
      name: row.name,
      url: row.url,
      format: row.format || 'text_lines',
      defaultProtocol: row.default_protocol || undefined,
      fetchIntervalMinutes: row.fetch_interval_minutes || 15,
      enabled: row.enabled === 1,
      headers,
      lastFetchedAt: row.last_fetched_at || undefined,
      nextFetchAt: row.next_fetch_at || undefined,
      lastFetchedCount: row.last_fetched_count || 0,
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
