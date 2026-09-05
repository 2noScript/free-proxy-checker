export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Free Proxy Checker & Central Basket Engine API',
    version: '1.4.0',
    description:
      'High-performance API for multi-source proxy aggregation, Central Candidate Basket with smart deduplication & 3m cooldown, Dual-Stream parallel execution (Source Ingestion & 3m Live Pool Maintenance), Proxy Authentication (HTTP Basic Auth & SOCKS5 RFC 1929), GeoIP resolution, and SQLite WAL persistence.',
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
    { name: 'Proxies', description: 'Query and export clean verified proxies with rich filters and pagination' },
    { name: 'Sources', description: 'Manage multi-source ingestion schedules and SQLite persistence' },
    { name: 'Diagnostics & Testing', description: 'On-demand proxy verification with authentication support and scan triggers' },
    { name: 'Health & Stats', description: 'System health, candidate basket status, protocol breakdowns, and dual-stream progress' },
  ],
  paths: {
    '/api/stats': {
      get: {
        tags: ['Health & Stats'],
        summary: 'Get Aggregate Statistics, Candidate Basket & Stream States',
        description: 'Returns total count, live/dead counts, average latency, protocol breakdowns, country distribution, candidate basket size, deduplication savings, registered sources, and stream progress.',
        responses: {
          '200': {
            description: 'Aggregated statistics, candidate queue, and stream health',
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
        summary: 'Get Clean Verified Live Proxies (JSON - Paginated)',
        description: 'Returns array of verified live proxies sorted by lowest latency. Supports rich filtering by protocol, country, source ID, IP substring, search keyword, anonymity, and max ping, along with pagination.',
        parameters: [
          { name: 'protocol', in: 'query', description: 'Filter by protocol', schema: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'] } },
          { name: 'country', in: 'query', description: 'Filter by ISO 2-letter country code', schema: { type: 'string', example: 'US' } },
          { name: 'source_id', in: 'query', description: 'Filter by registered Source ID', schema: { type: 'string', example: 'proxifly-all' } },
          { name: 'ip', in: 'query', description: 'Filter by IP substring', schema: { type: 'string', example: '47.82' } },
          { name: 'search', in: 'query', description: 'Search keyword across IP, port, city, ISP', schema: { type: 'string', example: 'San Mateo' } },
          { name: 'max_latency', in: 'query', description: 'Maximum latency in milliseconds', schema: { type: 'integer', example: 300 } },
          { name: 'anonymity', in: 'query', description: 'Filter by anonymity level', schema: { type: 'string', enum: ['elite', 'anonymous', 'transparent'] } },
          { name: 'limit', in: 'query', description: 'Page limit (optional)', schema: { type: 'integer', default: 50, example: 50 } },
          { name: 'page', in: 'query', description: 'Page number (1-based)', schema: { type: 'integer', default: 1, example: 1 } },
          { name: 'offset', in: 'query', description: 'Pagination offset', schema: { type: 'integer', default: 0, example: 0 } },
        ],
        responses: {
          '200': {
            description: 'Paginated list of live proxies',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer', example: 1540 },
                    count: { type: 'integer', example: 50 },
                    page: { type: 'integer', example: 1 },
                    totalPages: { type: 'integer', example: 31 },
                    limit: { type: 'integer', example: 50 },
                    offset: { type: 'integer', example: 0 },
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
          { name: 'limit', in: 'query', description: 'Page limit (default 50)', schema: { type: 'integer', default: 50 } },
          { name: 'page', in: 'query', description: 'Page number (1-based)', schema: { type: 'integer', default: 1 } },
          { name: 'offset', in: 'query', description: 'Pagination offset (default 0)', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Paginated proxy records across all statuses',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer', example: 58000 },
                    count: { type: 'integer', example: 50 },
                    page: { type: 'integer', example: 1 },
                    totalPages: { type: 'integer', example: 1160 },
                    limit: { type: 'integer', example: 50 },
                    offset: { type: 'integer', example: 0 },
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
        summary: 'Export Live Proxies as Raw Text Lines (Crawler & Automation Ready)',
        description:
          'Returns plain text lines formatted as `protocol://[user:pass@]ip:port` (format=url) or `ip:port[:user:pass]` (format=ip_port). If credentials exist, they are preserved automatically.',
        parameters: [
          { name: 'protocol', in: 'query', schema: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'] } },
          { name: 'country', in: 'query', schema: { type: 'string', example: 'US' } },
          { name: 'source_id', in: 'query', schema: { type: 'string', example: 'thespeedx-socks5' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'max_latency', in: 'query', schema: { type: 'integer', example: 400 } },
          {
            name: 'format',
            in: 'query',
            description: 'Output format: "url" -> protocol://[user:pass@]ip:port, "ip_port" -> ip:port[:user:pass]',
            schema: { type: 'string', enum: ['url', 'ip_port'], default: 'url' },
          },
        ],
        responses: {
          '200': {
            description: 'Plain text proxy list ready for crawler ingestion',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                  example: 'socks5://admin:pass123@47.82.80.23:1011\nsocks5://47.250.211.53:1080\nhttp://185.162.231.238:80',
                },
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
        summary: 'On-Demand Single Proxy Verification with Auth Support',
        description:
          'Tests any arbitrary proxy string using native TCP socket handshake, computes true latency, handles HTTP Basic Auth or SOCKS5 RFC 1929 subnegotiation, detects 407 Proxy Authentication Required errors, and resolves GeoIP.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['proxy'],
                properties: {
                  proxy: {
                    type: 'string',
                    example: 'socks5://admin:secret123@104.248.63.15:1080',
                    description: 'Formats: protocol://[user:pass@]ip:port or ip:port[:user:pass]',
                  },
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
        summary: 'Manually Trigger Maintenance / Source Ingestion Scan',
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
        summary: 'Real-Time Progress Event Stream (SSE)',
        description: 'Server-Sent Events stream delivering live verification progress updates for both Stream 1 (Candidate Basket Screening) and Stream 2 (3-Min Maintenance).',
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
          id: { type: 'string', example: 'socks5://admin:secret123@47.82.80.23:1011' },
          ip: { type: 'string', example: '47.82.80.23' },
          port: { type: 'integer', example: 1011 },
          protocol: { type: 'string', enum: ['socks5', 'socks4', 'http', 'https'], example: 'socks5' },
          username: { type: 'string', example: 'admin', nullable: true },
          password: { type: 'string', example: 'secret123', nullable: true },
          status: { type: 'string', enum: ['live', 'warning', 'dead'], example: 'live' },
          latencyMs: { type: 'integer', example: 77 },
          countryCode: { type: 'string', example: 'US' },
          countryName: { type: 'string', example: 'United States' },
          flag: { type: 'string', example: '🇺🇸' },
          city: { type: 'string', example: 'San Mateo' },
          isp: { type: 'string', example: 'Alibaba Cloud' },
          anonymity: { type: 'string', enum: ['elite', 'anonymous', 'transparent', 'unknown'], example: 'elite' },
          sourceId: { type: 'string', example: 'proxifly-all' },
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
          id: { type: 'string', example: 'socks5://admin:secret123@104.248.63.15:1080' },
          ip: { type: 'string', example: '104.248.63.15' },
          port: { type: 'integer', example: 1080 },
          protocol: { type: 'string', example: 'socks5' },
          username: { type: 'string', example: 'admin', nullable: true },
          password: { type: 'string', example: 'secret123', nullable: true },
          isAlive: { type: 'boolean', example: true },
          latencyMs: { type: 'integer', example: 145 },
          anonymity: { type: 'string', example: 'elite' },
          egressIp: { type: 'string', example: '104.248.63.15' },
          error: { type: 'string', example: '407 Proxy Authentication Required (Missing credentials)' },
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
          isp: { type: 'string', example: 'DigitalOcean' },
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
              activeTask: { type: 'string', example: 'Screening Basket (58,800 waiting)' },
              queueSize: { type: 'integer', example: 58800 },
              dedupSavedTotal: { type: 'integer', example: 12450 },
            },
          },
          maintenance: {
            type: 'object',
            properties: {
              intervalMinutes: { type: 'integer', example: 3 },
              lastRunAt: { type: 'string' },
              nextRunAt: { type: 'string' },
              isRunning: { type: 'boolean', example: false },
              activeTask: { type: 'string', example: null, nullable: true },
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Free Proxy Checker API - Swagger Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #0b0f19;
      --bg-card: #111827;
      --bg-elevated: #1f2937;
      --border-color: #374151;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
    }
    body {
      margin: 0;
      background-color: var(--bg-main);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .custom-header {
      background: linear-gradient(180deg, #111827 0%, #0b0f19 100%);
      border-bottom: 1px solid #1f2937;
      padding: 18px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .custom-header .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 1.15rem;
      font-weight: 700;
      color: #fff;
    }
    .custom-header .brand span.badge {
      font-size: 0.72rem;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #a5b4fc;
      font-family: 'JetBrains Mono', monospace;
    }
    .custom-header a.back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #94a3b8;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .custom-header a.back-btn:hover {
      color: #f8fafc;
      background: #334155;
    }
    .swagger-ui .topbar { display: none; }
    .swagger-ui {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 20px 60px;
      filter: invert(90%) hue-rotate(180deg);
    }
    .swagger-ui img {
      filter: invert(100%) hue-rotate(180deg);
    }
    .swagger-ui .info {
      margin: 20px 0 30px;
    }
    .swagger-ui .info .title {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 800;
      color: #4338ca;
    }
    .swagger-ui .opblock-tag {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 700;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 8px;
    }
    .swagger-ui .opblock {
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      margin-bottom: 14px;
    }
    .swagger-ui .opblock .opblock-summary-method {
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
    }
    .swagger-ui input, .swagger-ui select, .swagger-ui textarea {
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
    }
    .swagger-ui .btn {
      border-radius: 8px;
      font-weight: 600;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
  </style>
</head>
<body>
  <header class="custom-header">
    <div class="brand">
      <span>🛡️ Free Proxy Checker</span>
      <span class="badge">OpenAPI 3.1 &bull; v1.4.0</span>
    </div>
    <div>
      <a href="/" class="back-btn">
        <span>&larr; Web Dashboard</span>
      </a>
    </div>
  </header>

  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 3,
        displayRequestDuration: true,
        tryItOutEnabled: true,
        filter: true
      });
    };
  </script>
</body>
</html>`;
}
