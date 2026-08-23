import fs from 'node:fs';
import path from 'node:path';
import type { ProxySourceConfig } from './types';

const DEFAULT_SOURCES: ProxySourceConfig[] = [
  {
    id: 'iplocate-all',
    name: 'IPLocate Global Free Proxies',
    url: 'https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt',
    format: 'text_lines',
    fetchIntervalMinutes: 15,
    enabled: true,
  },
  {
    id: 'proxifly-all',
    name: 'Proxifly Free Proxies',
    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt',
    format: 'text_lines',
    fetchIntervalMinutes: 5,
    enabled: true,
  },
];

export const APP_CONFIG = {
  PORT: Number(process.env.PORT || 8340),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || 'data/proxies.db',
  SOURCES_FILE_PATH: process.env.SOURCES_FILE_PATH || 'data/sources.json',

  // Pyramid Lifecycle & Concurrency
  MAINTENANCE_INTERVAL_MINUTES: Number(process.env.MAINTENANCE_INTERVAL_MINUTES || 3),
  CONCURRENCY_LIMIT: Number(process.env.CONCURRENCY_LIMIT || 30),
  TIMEOUT_MS: Number(process.env.TIMEOUT_MS || 2500),
  MAX_CONSECUTIVE_FAILS: Number(process.env.MAX_CONSECUTIVE_FAILS || 2),

  // High-availability Fast Echo Targets (Rotated to avoid any rate limits)
  TARGET_URLS: [
    'https://cloudflare.com/cdn-cgi/trace',
    'https://api.ipify.org?format=json',
    'https://icanhazip.com',
    'https://httpbin.org/ip',
  ],

  /**
   * Load sources dynamically from mounted sources.json
   */
  loadSources(): ProxySourceConfig[] {
    try {
      const filePath = APP_CONFIG.SOURCES_FILE_PATH;
      const dir = path.dirname(filePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }

      // Auto-generate default sources.json if not present
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SOURCES, null, 2), 'utf-8');
      return DEFAULT_SOURCES;
    } catch (err) {
      console.error('⚠️ [Config] Error reading sources.json, using defaults:', err);
      return DEFAULT_SOURCES;
    }
  },

  /**
   * Save sources dynamically to mounted sources.json
   */
  saveSources(sources: ProxySourceConfig[]) {
    try {
      const filePath = APP_CONFIG.SOURCES_FILE_PATH;
      fs.writeFileSync(filePath, JSON.stringify(sources, null, 2), 'utf-8');
    } catch (err) {
      console.error('⚠️ [Config] Error saving sources.json:', err);
    }
  },
};
