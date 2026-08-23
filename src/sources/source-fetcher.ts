import type { CheckQueueItem } from '../checker/queue-runner';
import type { ProxyProtocol, ProxySourceConfig } from '../types';

export class SourceFetcher {
  /**
   * Fetch and parse proxy list from a configured source
   */
  async fetchSource(source: ProxySourceConfig): Promise<CheckQueueItem[]> {
    console.log(`📥 [Source Fetcher] Fetching proxies from [${source.name}] (${source.url}) ...`);

    try {
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          ...source.headers,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch source: HTTP ${response.status}`);
      }

      const text = await response.text();
      const parsed = this.parseTextLines(text, source);
      console.log(`✅ [Source Fetcher] Parsed ${parsed.length} proxies from [${source.name}]`);
      return parsed;
    } catch (err: any) {
      console.error(`❌ [Source Fetcher Error] Failed fetching [${source.name}]:`, err?.message || err);
      return [];
    }
  }

  /**
   * Parse text lines with support for various protocols
   */
  private parseTextLines(text: string, source: ProxySourceConfig): CheckQueueItem[] {
    const lines = text.split(/\r?\n/);
    const seen = new Set<string>();
    const items: CheckQueueItem[] = [];

    for (let rawLine of lines) {
      rawLine = rawLine.trim();
      if (!rawLine || rawLine.startsWith('#') || rawLine.startsWith('//')) continue;

      let protocol: ProxyProtocol = source.defaultProtocol || 'http';
      let cleanLine = rawLine;

      if (rawLine.includes('://')) {
        const parts = rawLine.split('://');
        if (parts.length >= 2 && parts[0] && parts[1]) {
          const protoStr = parts[0].toLowerCase();
          if (protoStr === 'socks5' || protoStr === 'socks4' || protoStr === 'http' || protoStr === 'https') {
            protocol = protoStr as ProxyProtocol;
          }
          cleanLine = parts[1];
        }
      }

      // Remove any trailing auth or path e.g. "ip:port:user:pass"
      const segments = cleanLine.split(':');
      if (segments.length >= 2 && segments[0] && segments[1]) {
        const ip = segments[0].trim();
        const port = Number.parseInt(segments[1].trim(), 10);

        if (this.isValidIp(ip) && !Number.isNaN(port) && port > 0 && port <= 65535) {
          const id = `${protocol}://${ip}:${port}`;
          if (!seen.has(id)) {
            seen.add(id);
            items.push({
              id,
              ip,
              port,
              protocol,
              sourceId: source.id,
            });
          }
        }
      }
    }

    return items;
  }

  private isValidIp(ip: string): boolean {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) return false;
    const parts = ip.split('.').map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
}

export const sourceFetcher = new SourceFetcher();
