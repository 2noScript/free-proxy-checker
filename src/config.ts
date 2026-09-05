import type { ProxySourceConfig } from './types';

export const DEFAULT_SOURCES: ProxySourceConfig[] = [
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
  {
    id: 'thespeedx-http',
    name: 'TheSpeedX HTTP Proxies',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    format: 'text_lines',
    defaultProtocol: 'http',
    fetchIntervalMinutes: 180,
    enabled: true,
  },
  {
    id: 'thespeedx-socks4',
    name: 'TheSpeedX SOCKS4 Proxies',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt',
    format: 'text_lines',
    defaultProtocol: 'socks4',
    fetchIntervalMinutes: 180,
    enabled: true,
  },
  {
    id: 'thespeedx-socks5',
    name: 'TheSpeedX SOCKS5 Proxies',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    format: 'text_lines',
    defaultProtocol: 'socks5',
    fetchIntervalMinutes: 180,
    enabled: true,
  },
  // --- Monosans (Hourly, Multi-Protocol) ---
  {
    id: 'monosans-all',
    name: 'Monosans Multi-Protocol',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/all.txt',
    format: 'text_lines',
    fetchIntervalMinutes: 30,
    enabled: true,
  },
  // --- Komutan234 (Fast Refresh - 2min) ---
  {
    id: 'komutan-http',
    name: 'Komutan Fast HTTP',
    url: 'https://raw.githubusercontent.com/komutan234/Proxy-List-Free/main/proxies/http.txt',
    format: 'text_lines',
    defaultProtocol: 'http',
    fetchIntervalMinutes: 5,
    enabled: true,
  },
  {
    id: 'komutan-socks5',
    name: 'Komutan Fast SOCKS5',
    url: 'https://raw.githubusercontent.com/komutan234/Proxy-List-Free/main/proxies/socks5.txt',
    format: 'text_lines',
    defaultProtocol: 'socks5',
    fetchIntervalMinutes: 5,
    enabled: true,
  },
  // --- ProxyScrape Live API ---
  {
    id: 'proxyscrape-http',
    name: 'ProxyScrape Live HTTP',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
    format: 'text_lines',
    defaultProtocol: 'http',
    fetchIntervalMinutes: 15,
    enabled: true,
  },
  {
    id: 'proxyscrape-socks5',
    name: 'ProxyScrape Live SOCKS5',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all',
    format: 'text_lines',
    defaultProtocol: 'socks5',
    fetchIntervalMinutes: 15,
    enabled: true,
  },
  // --- Hookzof Dedicated SOCKS5 ---
  {
    id: 'hookzof-socks5',
    name: 'Hookzof SOCKS5',
    url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
    format: 'text_lines',
    defaultProtocol: 'socks5',
    fetchIntervalMinutes: 60,
    enabled: true,
  },
];

export const APP_CONFIG = {
  PORT: Number(process.env.PORT || 8340),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || 'data/proxies.db',

  // Pyramid Lifecycle & Concurrency
  MAINTENANCE_INTERVAL_MINUTES: Number(process.env.MAINTENANCE_INTERVAL_MINUTES || 3),
  CONCURRENCY_LIMIT: Number(process.env.CONCURRENCY_LIMIT || 50),
  TIMEOUT_MS: Number(process.env.TIMEOUT_MS || 2500),
  MAX_CONSECUTIVE_FAILS: Number(process.env.MAX_CONSECUTIVE_FAILS || 2),

  // Producer-Consumer Basket & Deduplication
  DEDUP_COOLDOWN_MINUTES: Number(process.env.DEDUP_COOLDOWN_MINUTES || 3),
  SCREENING_BATCH_SIZE: Number(process.env.SCREENING_BATCH_SIZE || 150),

  // High-availability Fast Echo Targets (Rotated to avoid any rate limits)
  TARGET_URLS: [
    'https://cloudflare.com/cdn-cgi/trace',
    'https://api.ipify.org?format=json',
    'https://icanhazip.com',
    'https://httpbin.org/ip',
  ],
};
