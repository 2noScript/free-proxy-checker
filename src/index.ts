import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { APP_CONFIG } from './config';
import { createApiRouter } from './api/routes';
import { scheduler } from './services/scheduler';

async function main() {
  console.log('🛡️ ========================================================');
  console.log('🛡️ FREE PROXY CHECKER - PYRAMID LIFECYCLE & MULTI-SOURCE');
  console.log('🛡️ ========================================================');
  console.log(`⚙️  Host: ${APP_CONFIG.HOST} | Port: ${APP_CONFIG.PORT} | Concurrency: ${APP_CONFIG.CONCURRENCY_LIMIT}`);
  console.log(`⏱️  Maintenance: Every ${APP_CONFIG.MAINTENANCE_INTERVAL_MINUTES}m | SQLite: ${APP_CONFIG.DB_PATH}`);

  const app = new Hono();

  // 1. Mount API Router
  const api = createApiRouter();
  app.route('/', api);

  // 2. Static Web Dashboard SPA
  app.use('/*', serveStatic({ root: './public' }));
  app.get('*', serveStatic({ path: './public/index.html' }));

  // 3. Start Scheduler
  scheduler.start();

  // 4. Start Server
  const server = Bun.serve({
    port: APP_CONFIG.PORT,
    hostname: APP_CONFIG.HOST,
    fetch: app.fetch,
  });

  const displayHost = APP_CONFIG.HOST === '0.0.0.0' ? '127.0.0.1' : APP_CONFIG.HOST;
  console.log(`🌐 Web Dashboard & Hono API : http://${displayHost}:${APP_CONFIG.PORT}`);
  console.log(`📖 Swagger API Docs         : http://${displayHost}:${APP_CONFIG.PORT}/swagger`);
  console.log(`🚀 System Ready & Active!`);

  return server;
}

main().catch((err) => {
  console.error('Fatal Service Error:', err);
  process.exit(1);
});
