import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { candidateWorker } from '../checker/candidate-worker';
import { ingestionRunner, maintenanceRunner } from '../checker/queue-runner';
import { socketChecker } from '../checker/socket-checker';
import { db } from '../db';
import { geoService } from '../services/geoip.service';
import { scheduler } from '../services/scheduler';
import type { ProxyProtocol, ProxySourceConfig } from '../types';
import { openApiSpec, renderSwaggerUI } from './openapi';

export function createApiRouter() {
  const app = new Hono();

  app.use('*', cors());

  // Swagger Documentation
  app.get('/openapi.json', (c) => c.json(openApiSpec));
  app.get('/swagger', (c) => c.html(renderSwaggerUI()));
  app.get('/doc', (c) => c.html(renderSwaggerUI()));

  // 1. Stats & Health Overview (Dual Streams)
  app.get('/api/stats', (c) => {
    const stats = db.getStats();
    const sources = scheduler.getSources().map((s) => ({
      id: s.id,
      name: s.name,
      intervalMinutes: s.fetchIntervalMinutes,
      lastFetchedAt: s.lastFetchedAt,
      nextFetchAt: s.nextFetchAt,
      lastCount: s.lastFetchedCount || 0,
      enabled: s.enabled,
    }));
    const schedulerStatus = scheduler.getStatus();

    return c.json({
      ...stats,
      sources,
      ingestion: schedulerStatus.ingestion,
      maintenance: schedulerStatus.maintenance,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Get Live Proxies (JSON - with pagination)
  app.get('/api/proxies', (c) => {
    const protocol = c.req.query('protocol');
    const country = c.req.query('country');
    const ip = c.req.query('ip');
    const search = c.req.query('search') || c.req.query('q');
    const anonymity = c.req.query('anonymity');
    const sourceId = c.req.query('source_id') || c.req.query('source');
    const maxLatency = c.req.query('max_latency') ? Number(c.req.query('max_latency')) : undefined;

    const limitQuery = c.req.query('limit');
    const limit = limitQuery ? Number(limitQuery) : undefined;
    const page = c.req.query('page') ? Math.max(1, Number(c.req.query('page'))) : undefined;
    const offsetQuery = c.req.query('offset');
    const offset = page && limit ? (page - 1) * limit : (offsetQuery ? Number(offsetQuery) : 0);

    const total = db.countLiveProxies({ protocol, country, ip, search, anonymity, sourceId, maxLatency });
    const proxies = db.getLiveProxies({ protocol, country, ip, search, anonymity, sourceId, maxLatency, limit, offset });

    const totalPages = limit ? Math.ceil(total / limit) : 1;
    const currentPage = page || (limit ? Math.floor(offset / limit) + 1 : 1);

    return c.json({
      total,
      count: proxies.length,
      page: currentPage,
      totalPages,
      limit: limit ?? total,
      offset,
      proxies,
    });
  });

  // 3. Get All Proxies (Paginated with full filters)
  app.get('/api/proxies/all', (c) => {
    const status = c.req.query('status');
    const protocol = c.req.query('protocol');
    const country = c.req.query('country');
    const ip = c.req.query('ip');
    const search = c.req.query('search') || c.req.query('q');
    const anonymity = c.req.query('anonymity');
    const sourceId = c.req.query('source_id') || c.req.query('source');
    const maxLatency = c.req.query('max_latency') ? Number(c.req.query('max_latency')) : undefined;
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 50;
    const page = c.req.query('page') ? Math.max(1, Number(c.req.query('page'))) : undefined;
    const offsetQuery = c.req.query('offset');
    const offset = page ? (page - 1) * limit : (offsetQuery ? Number(offsetQuery) : 0);

    const total = db.countAllProxies({ status, protocol, country, ip, search, anonymity, sourceId, maxLatency });
    const proxies = db.getAllProxies({ status, protocol, country, ip, search, anonymity, sourceId, maxLatency, limit, offset });

    const totalPages = Math.ceil(total / limit);
    const currentPage = page || Math.floor(offset / limit) + 1;

    return c.json({
      total,
      count: proxies.length,
      page: currentPage,
      totalPages,
      limit,
      offset,
      proxies,
    });
  });

  // 4. Get Raw Text Lines (For Crawler Ingestion)
  app.get('/api/proxies/raw', (c) => {
    const protocol = c.req.query('protocol');
    const country = c.req.query('country');
    const ip = c.req.query('ip');
    const search = c.req.query('search') || c.req.query('q');
    const anonymity = c.req.query('anonymity');
    const maxLatency = c.req.query('max_latency') ? Number(c.req.query('max_latency')) : undefined;
    const format = c.req.query('format') || 'url'; // 'url' or 'ip_port'

    const proxies = db.getLiveProxies({ protocol, country, ip, search, anonymity, maxLatency });
    const lines = proxies.map((p) => {
      if (format === 'ip_port') {
        return p.username && p.password ? `${p.ip}:${p.port}:${p.username}:${p.password}` : `${p.ip}:${p.port}`;
      }
      return p.username && p.password
        ? `${p.protocol}://${p.username}:${p.password}@${p.ip}:${p.port}`
        : `${p.protocol}://${p.ip}:${p.port}`;
    });

    return c.text(lines.join('\n'), 200, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  });

  // 5. Sources Management
  app.get('/api/sources', (c) => {
    return c.json(scheduler.getSources());
  });

  app.post('/api/sources', async (c) => {
    try {
      const body = await c.req.json() as ProxySourceConfig;
      if (!body.id || !body.name || !body.url || !body.fetchIntervalMinutes) {
        return c.json({ error: 'Missing required fields: id, name, url, fetchIntervalMinutes' }, 400);
      }

      scheduler.addSource({
        ...body,
        enabled: body.enabled ?? true,
        format: body.format || 'text_lines',
      });

      return c.json({ success: true, message: `Source [${body.name}] registered successfully!` });
    } catch (err: any) {
      return c.json({ error: err?.message || 'Invalid JSON' }, 400);
    }
  });

  app.patch('/api/sources/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = (await c.req.json()) as Partial<ProxySourceConfig>;
      const updated = scheduler.updateSource(id, body);
      if (!updated) {
        return c.json({ error: `Source not found: ${id}` }, 404);
      }
      return c.json({ success: true, message: `Source [${id}] updated` });
    } catch (err: any) {
      return c.json({ error: err?.message || 'Invalid JSON' }, 400);
    }
  });

  app.delete('/api/sources/:id', (c) => {
    const id = c.req.param('id');
    const deleted = scheduler.deleteSource(id);
    if (!deleted) {
      return c.json({ error: `Source not found: ${id}` }, 404);
    }
    return c.json({ success: true, message: `Source [${id}] deleted` });
  });

  // 6. Manual Scan Trigger
  app.post('/api/trigger-scan', async (c) => {
    const type = c.req.query('type') || 'maintenance';
    const sourceId = c.req.query('source_id');

    if (type === 'ingest') {
      const sources = scheduler.getSources();
      const targetSource = sourceId ? sources.find((s) => s.id === sourceId) : sources[0];
      if (targetSource) {
        scheduler.triggerSourceIngestion(targetSource);
      }
    } else if (type === 'worker') {
      candidateWorker.wakeUp();
    } else {
      scheduler.triggerMaintenanceCycle();
    }
    return c.json({ success: true, message: `Triggered ${type} scan in background` });
  });

  // 7. Check a single proxy on-demand
  app.post('/api/check-single', async (c) => {
    try {
      const body = await c.req.json() as { proxy: string };
      if (!body.proxy) {
        return c.json({ error: 'proxy string required' }, 400);
      }

      let protocol: ProxyProtocol = 'http';
      let clean = body.proxy.trim();
      if (clean.includes('://')) {
        const parts = clean.split('://');
        if (parts.length >= 2 && parts[0] && parts[1]) {
          const protoStr = parts[0].toLowerCase();
          if (protoStr === 'socks5' || protoStr === 'socks4' || protoStr === 'http' || protoStr === 'https') {
            protocol = protoStr as ProxyProtocol;
          }
          clean = parts.slice(1).join('://');
        }
      }

      let ip = '';
      let port = 0;
      let username: string | undefined;
      let password: string | undefined;

      if (clean.includes('@')) {
        const atParts = clean.split('@');
        const authPart = atParts[0];
        const hostPart = atParts.slice(1).join('@');
        if (authPart.includes(':')) {
          const creds = authPart.split(':');
          username = creds[0].trim();
          password = creds.slice(1).join(':').trim();
        } else {
          username = authPart.trim();
        }

        const hostSegments = hostPart.split(':');
        if (hostSegments.length >= 2) {
          ip = hostSegments[0].trim();
          port = Number.parseInt(hostSegments[1].trim(), 10);
        }
      } else {
        const segments = clean.split(':');
        if (segments.length >= 2) {
          ip = segments[0].trim();
          port = Number.parseInt(segments[1].trim(), 10);
          if (segments.length >= 4) {
            username = segments[2].trim();
            password = segments.slice(3).join(':').trim();
          }
        }
      }

      if (!ip || !port || Number.isNaN(port) || port < 1 || port > 65535) {
        return c.json({ error: 'Invalid proxy format. Expected ip:port, ip:port:user:pass, or protocol://user:pass@ip:port' }, 400);
      }

      const id = username && password
        ? `${protocol}://${username}:${password}@${ip}:${port}`
        : `${protocol}://${ip}:${port}`;

      const result = await socketChecker.check({
        id,
        ip,
        port,
        protocol,
        username,
        password,
      });

      let geo;
      if (result.isAlive) {
        geo = await geoService.lookup(ip);
      }

      db.updateCheckResult(result, geo);

      return c.json({ result, geo });
    } catch (err: any) {
      return c.json({ error: err?.message || 'Invalid request' }, 400);
    }
  });

  // 8. Real-time Progress Stream (SSE)
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ message: 'Connected to Proxy Checker SSE' }) });

      const unsubIngest = ingestionRunner.subscribeProgress(async (progress) => {
        try {
          await stream.writeSSE({ event: 'progress', data: JSON.stringify(progress) });
        } catch {}
      });

      const unsubMaint = maintenanceRunner.subscribeProgress(async (progress) => {
        try {
          await stream.writeSSE({ event: 'progress', data: JSON.stringify(progress) });
        } catch {}
      });

      stream.onAbort(() => {
        unsubIngest();
        unsubMaint();
      });

      while (true) {
        await stream.sleep(15000);
        await stream.writeSSE({ event: 'ping', data: 'heartbeat' });
      }
    });
  });

  return app;
}
