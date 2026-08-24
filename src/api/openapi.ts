export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Free Proxy Checker & Dual-Stream Engine API',
    version: '1.3.0',
    description:
      'High-performance API documentation for multi-source proxy aggregation, Dual-Stream independent parallel execution (Source Ingestion & 3m Live Pool Maintenance), automated dead proxy purging, GeoIP resolution, and SQLite WAL persistence.',
    contact: {
      name: 'Script-Pro Engineering',
    },
  },
  servers: [
    {
      url: 'http://127.0.0.1:8340',
      description: 'Local Proxy Checker Server',
    },
  ],
  tags: [
    { name: 'Proxies', description: 'Query and export clean verified proxies with rich filters' },
    { name: 'Sources', description: 'Manage multi-source ingestion schedules and SQLite persistence' },
    { name: 'Diagnostics & Testing', description: 'On-demand proxy verification and manual scan triggers' },
    { name: 'Health & Stats', description: 'System health, protocol breakdowns, and dual-stream statuses' },
  ],
  paths: {
    '/api/stats': {
      get: {
        tags: ['Health & Stats'],
        summary: 'Get Aggregate Statistics & Dual-Stream Status',
        description: 'Returns total count, live/dead counts, average latency, protocol breakdowns, country distribution, registered SQLite sources, and dual-stream progress states.',
        responses: {
          '200': {
            description: 'Aggregated statistics and dual-stream health',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SystemStats' },
              },
            },
          },
        },
      },
    },
    '/api/proxies': {
      get: {
        tags: ['Proxies'],
        summary: 'Get Clean Verified Live Proxies (JSON)',
        description: 'Returns array of verified live proxies sorted by lowest latency. Supports rich filtering by protocol, country, source ID, IP, search keyword, anonymity, and max ping.',
        parameters: [
          { name: 'protocol', in: 'query', description: 'Filter by protocol', schema: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'] } },
          { name: 'country', in: 'query', description: 'Filter by ISO 2-letter country code', schema: { type: 'string', example: 'US' } },
          { name: 'source_id', in: 'query', description: 'Filter by registered Source ID', schema: { type: 'string', example: 'iplocate-all' } },
          { name: 'ip', in: 'query', description: 'Filter by IP substring', schema: { type: 'string', example: '47.82' } },
          { name: 'search', in: 'query', description: 'Search keyword across IP, port, city, ISP', schema: { type: 'string', example: 'San Mateo' } },
          { name: 'max_latency', in: 'query', description: 'Maximum latency in milliseconds', schema: { type: 'integer', example: 300 } },
          { name: 'anonymity', in: 'query', description: 'Filter by anonymity level', schema: { type: 'string', enum: ['elite', 'anonymous', 'transparent'] } },
        ],
        responses: {
          '200': {
            description: 'Filtered list of live proxies',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer', example: 45 },
                    proxies: { type: 'array', items: { $ref: '#/components/schemas/ProxyRecord' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/proxies/all': {
      get: {
        tags: ['Proxies'],
        summary: 'Get All Proxies with Pagination & Status Filters',
        description: 'Returns paginated list of all proxies in the SQLite database across all statuses (live, warning, dead).',
        parameters: [
          { name: 'status', in: 'query', description: 'Filter by status', schema: { type: 'string', enum: ['live', 'warning', 'dead'] } },
          { name: 'protocol', in: 'query', schema: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'] } },
          { name: 'country', in: 'query', schema: { type: 'string', example: 'VN' } },
          { name: 'source_id', in: 'query', description: 'Filter by registered Source ID', schema: { type: 'string', example: 'proxifly-all' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'max_latency', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', description: 'Page limit (default 100)', schema: { type: 'integer', default: 100 } },
          { name: 'offset', in: 'query', description: 'Pagination offset (default 0)', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Paginated proxy records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    proxies: { type: 'array', items: { $ref: '#/components/schemas/ProxyRecord' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/proxies/raw': {
      get: {
        tags: ['Proxies'],
        summary: 'Export Live Proxies as Raw Text Lines (Crawler Ready)',
        description: 'Returns plain text list formatted as `protocol://ip:port` or `ip:port` ready for ingestion by Playwright, Camoufox, or crawler workers.',
        parameters: [
          { name: 'protocol', in: 'query', schema: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'] } },
          { name: 'country', in: 'query', schema: { type: 'string', example: 'US' } },
          { name: 'source_id', in: 'query', schema: { type: 'string', example: 'thespeedx-socks5' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'max_latency', in: 'query', schema: { type: 'integer', example: 400 } },
          { name: 'format', in: 'query', description: 'Output format', schema: { type: 'string', enum: ['url', 'ip_port'], default: 'url' } },
        ],
        responses: {
          '200': {
            description: 'Plain text proxy list',
            content: {
              'text/plain': {
                schema: { type: 'string', example: 'socks5://47.82.80.23:1011\nsocks5://47.250.211.53:1080' },
              },
            },
          },
        },
      },
    },
    '/api/sources': {
      get: {
        tags: ['Sources'],
        summary: 'List Registered Ingestion Sources (from SQLite)',
        description: 'Returns list of configured proxy sources with their individual fetch intervals, last fetch counts, and next scheduled runs.',
        responses: {
          '200': {
            description: 'List of registered sources',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ProxySourceConfig' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['Sources'],
        summary: 'Register New Proxy Source into SQLite Database',
        description: 'Dynamically register a new proxy source URL with custom fetch interval directly stored into SQLite without restarting.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'name', 'url', 'fetchIntervalMinutes'],
                properties: {
                  id: { type: 'string', example: 'my-custom-list' },
                  name: { type: 'string', example: 'My Custom Proxies' },
                  url: { type: 'string', example: 'https://raw.githubusercontent.com/.../proxies.txt' },
                  fetchIntervalMinutes: { type: 'integer', example: 15 },
                  defaultProtocol: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'] },
                  format: { type: 'string', enum: ['text_lines', 'json', 'csv'], default: 'text_lines' },
                  enabled: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Source successfully registered' },
        },
      },
    },
    '/api/sources/{id}': {
      patch: {
        tags: ['Sources'],
        summary: 'Update or Toggle Source in SQLite Database',
        description: 'Update source properties like enabled/disabled status, fetch interval, or name.',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Source identifier', schema: { type: 'string', example: 'iplocate-all' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  fetchIntervalMinutes: { type: 'integer' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Source updated successfully' },
          '404': { description: 'Source not found' },
        },
      },
      delete: {
        tags: ['Sources'],
        summary: 'Delete Source from SQLite Database',
        description: 'Permanently remove a proxy source from SQLite persistence.',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Source identifier', schema: { type: 'string', example: 'my-custom-list' } },
        ],
        responses: {
          '200': { description: 'Source deleted successfully' },
          '404': { description: 'Source not found' },
        },
      },
    },
    '/api/check-single': {
      post: {
        tags: ['Diagnostics & Testing'],
        summary: 'On-Demand Single Proxy Verification',
        description: 'Instantly tests any arbitrary proxy string using native TCP socket handshake, computes true Ping ms, and resolves GeoIP.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['proxy'],
                properties: {
                  proxy: { type: 'string', example: 'socks5://104.248.63.15:1080' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Check result and GeoIP details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: { $ref: '#/components/schemas/CheckResult' },
                    geo: { $ref: '#/components/schemas/GeoInfo' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/trigger-scan': {
      post: {
        tags: ['Diagnostics & Testing'],
        summary: 'Manually Trigger Maintenance / Single Source Ingestion Scan',
        description: 'Forces an immediate background execution of either the 3-minute Live Pool maintenance re-check or a specific source ingestion.',
        parameters: [
          { name: 'type', in: 'query', description: 'Scan type to trigger', schema: { type: 'string', enum: ['maintenance', 'ingest'], default: 'maintenance' } },
          { name: 'source_id', in: 'query', description: 'Optional specific source ID to ingest', schema: { type: 'string', example: 'iplocate-all' } },
        ],
        responses: {
          '200': { description: 'Scan triggered in background' },
        },
      },
    },
    '/api/events': {
      get: {
        tags: ['Diagnostics & Testing'],
        summary: 'Real-Time Dual-Stream Progress Event Stream (SSE)',
        description: 'Server-Sent Events stream delivering live verification progress updates for both Stream 1 (Ingestion) and Stream 2 (Maintenance).',
        responses: {
          '200': {
            description: 'SSE stream connection',
            content: { 'text/event-stream': {} },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ProxyRecord: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'socks5://47.82.80.23:1011' },
          ip: { type: 'string', example: '47.82.80.23' },
          port: { type: 'integer', example: 1011 },
          protocol: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'], example: 'socks5' },
          status: { type: 'string', enum: ['live', 'warning', 'dead'], example: 'live' },
          latencyMs: { type: 'integer', example: 77 },
          countryCode: { type: 'string', example: 'US' },
          countryName: { type: 'string', example: 'United States' },
          flag: { type: 'string', example: '🇺🇸' },
          city: { type: 'string', example: 'San Mateo' },
          isp: { type: 'string', example: 'Alibaba Cloud' },
          anonymity: { type: 'string', enum: ['elite', 'anonymous', 'transparent'], example: 'elite' },
          sourceId: { type: 'string', example: 'iplocate-all' },
          successCount: { type: 'integer', example: 5 },
          failCount: { type: 'integer', example: 0 },
          consecutiveFails: { type: 'integer', example: 0 },
          firstSeenAt: { type: 'string', example: '2026-08-24T04:07:40.145Z' },
          lastCheckedAt: { type: 'string', example: '2026-08-24T04:19:33.728Z' },
          lastLiveAt: { type: 'string', example: '2026-08-24T04:19:33.728Z' },
        },
      },
      CheckResult: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'socks5://104.248.63.15:1080' },
          ip: { type: 'string', example: '104.248.63.15' },
          port: { type: 'integer', example: 1080 },
          protocol: { type: 'string', example: 'socks5' },
          isAlive: { type: 'boolean', example: true },
          latencyMs: { type: 'integer', example: 145 },
          anonymity: { type: 'string', example: 'elite' },
          egressIp: { type: 'string', example: '104.248.63.15' },
          error: { type: 'string' },
        },
      },
      GeoInfo: {
        type: 'object',
        properties: {
          ip: { type: 'string', example: '104.248.63.15' },
          countryCode: { type: 'string', example: 'US' },
          countryName: { type: 'string', example: 'United States' },
          flag: { type: 'string', example: '🇺🇸' },
          city: { type: 'string', example: 'North Bergen' },
        },
      },
      ProxySourceConfig: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'iplocate-all' },
          name: { type: 'string', example: 'IPLocate Global Free Proxies' },
          url: { type: 'string', example: 'https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt' },
          format: { type: 'string', example: 'text_lines' },
          fetchIntervalMinutes: { type: 'integer', example: 15 },
          enabled: { type: 'boolean', example: true },
          lastFetchedAt: { type: 'string' },
          nextFetchAt: { type: 'string' },
          lastFetchedCount: { type: 'integer', example: 953 },
        },
      },
      SystemStats: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 953 },
          live: { type: 'integer', example: 569 },
          dead: { type: 'integer', example: 38 },
          warning: { type: 'integer', example: 346 },
          avgLatency: { type: 'integer', example: 215 },
          byProtocol: { type: 'object', example: { socks5: 339, http: 186, socks4: 44 } },
          byCountry: { type: 'object', example: { '🇺🇸 US': 180, '🇨🇳 CN': 138, '🇸🇬 SG': 20 } },
          sources: { type: 'array', items: { $ref: '#/components/schemas/ProxySourceConfig' } },
          ingestion: {
            type: 'object',
            properties: {
              isRunning: { type: 'boolean', example: true },
              activeTask: { type: 'string', example: 'Ingestion: IPLocate Global Free Proxies' },
            },
          },
          maintenance: {
            type: 'object',
            properties: {
              intervalMinutes: { type: 'integer', example: 3 },
              lastRunAt: { type: 'string' },
              nextRunAt: { type: 'string' },
              isRunning: { type: 'boolean', example: false },
              activeTask: { type: 'string', example: '3-Min Maintenance' },
            },
          },
          timestamp: { type: 'string' },
        },
      },
    },
  },
};

export function renderSwaggerUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Free Proxy Checker API - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>">
  <style>
    body { margin: 0; background: #0b1329; color: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui { filter: invert(88%) hue-rotate(180deg); }
    .swagger-ui .wrapper { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .swagger-ui .info h2 { color: #38bdf8; }
    .swagger-ui .btn { border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 2
      });
    };
  </script>
</body>
</html>`;
}
