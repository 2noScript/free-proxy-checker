import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { queueRunner } from '../checker/queue-runner';
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

  // 1. Stats & Health Overview
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
    const maintenance = scheduler.getMaintenanceStatus();

    return c.json({
      ...stats,
      sources,
      maintenance,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Get Live Proxies (JSON)
  app.get('/api/proxies', (c) => {
    const protocol = c.req.query('protocol');
    const country = c.req.query('country');
    const ip = c.req.query('ip');
    const search = c.req.query('search') || c.req.query('q');
    const anonymity = c.req.query('anonymity');
    const maxLatency = c.req.query('max_latency') ? Number(c.req.query('max_latency')) : undefined;

    const proxies = db.getLiveProxies({ protocol, country, ip, search, anonymity, maxLatency });
    return c.json({
      count: proxies.length,
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
    const maxLatency = c.req.query('max_latency') ? Number(c.req.query('max_latency')) : undefined;
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 100;
    const offset = c.req.query('offset') ? Number(c.req.query('offset')) : 0;

    const proxies = db.getAllProxies({ status, protocol, country, ip, search, anonymity, maxLatency, limit, offset });
    return c.json({
      count: proxies.length,
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
    const lines = proxies.map((p) => (format === 'ip_port' ? `${p.ip}:${p.port}` : `${p.protocol}://${p.ip}:${p.port}`));

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

  // 6. Manual Scan Trigger
  app.post('/api/trigger-scan', async (c) => {
    const type = c.req.query('type') || 'maintenance';
    if (type === 'ingest') {
      const sources = scheduler.getSources();
      const firstSource = sources[0];
      if (firstSource) {
        scheduler.triggerSourceIngestion(firstSource);
      }
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
      let clean = body.proxy;
      if (body.proxy.includes('://')) {
        const parts = body.proxy.split('://');
        if (parts.length >= 2 && parts[0] && parts[1]) {
          const protoStr = parts[0].toLowerCase();
          if (protoStr === 'socks5' || protoStr === 'socks4' || protoStr === 'http' || protoStr === 'https') {
            protocol = protoStr as ProxyProtocol;
          }
          clean = parts[1];
        }
      }

      const segments = clean.split(':');
      const ip = segments[0] || '';
      const port = Number(segments[1] || 0);

      if (!ip || !port) {
        return c.json({ error: 'Invalid proxy format. Expected ip:port or protocol://ip:port' }, 400);
      }

      const result = await socketChecker.check({
        id: `${protocol}://${ip}:${port}`,
        ip,
        port,
        protocol,
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

      const unsubscribe = queueRunner.subscribeProgress(async (progress) => {
        try {
          await stream.writeSSE({ event: 'progress', data: JSON.stringify(progress) });
        } catch {}
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      while (true) {
        await stream.sleep(15000);
        await stream.writeSSE({ event: 'ping', data: 'heartbeat' });
      }
    });
  });

  return app;
}
