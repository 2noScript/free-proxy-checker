export type ProxyProtocol = 'socks5' | 'socks4' | 'http' | 'https';
export type ProxyStatus = 'live' | 'dead' | 'warning';
export type AnonymityLevel = 'elite' | 'anonymous' | 'transparent' | 'unknown';

export interface GeoInfo {
  ip: string;
  countryCode: string;
  countryName: string;
  flag: string;
  city?: string;
  isp?: string;
}

export interface ProxyRecord {
  id: string; // e.g. "socks5://104.248.63.15:1080"
  ip: string;
  port: number;
  protocol: ProxyProtocol;
  status: ProxyStatus;
  latencyMs: number;
  countryCode: string;
  countryName: string;
  flag: string;
  city: string;
  isp: string;
  anonymity: AnonymityLevel;
  sourceId: string;
  successCount: number;
  failCount: number;
  consecutiveFails: number;
  firstSeenAt: string;
  lastCheckedAt: string;
  lastLiveAt?: string;
}

export interface CheckResult {
  id: string;
  ip: string;
  port: number;
  protocol: ProxyProtocol;
  isAlive: boolean;
  latencyMs: number;
  error?: string;
  anonymity?: AnonymityLevel;
  egressIp?: string;
}

export interface ProxySourceConfig {
  id: string;
  name: string;
  url: string;
  format: 'text_lines' | 'json' | 'csv';
  fetchIntervalMinutes: number;
  enabled: boolean;
  defaultProtocol?: ProxyProtocol;
  headers?: Record<string, string>;
  lastFetchedAt?: string;
  nextFetchAt?: string;
  lastFetchedCount?: number;
}

export interface SystemStats {
  totalProxies: number;
  liveProxies: number;
  deadProxies: number;
  warningProxies: number;
  avgLatencyMs: number;
  byProtocol: Record<string, number>;
  byCountry: Record<string, number>;
  sources: {
    id: string;
    name: string;
    intervalMinutes: number;
    lastFetchedAt?: string;
    nextFetchAt?: string;
    lastCount: number;
    enabled: boolean;
  }[];
  maintenance: {
    intervalMinutes: number;
    lastRunAt?: string;
    nextRunAt?: string;
    isChecking: boolean;
  };
}
