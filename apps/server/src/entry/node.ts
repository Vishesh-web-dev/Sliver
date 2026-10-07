import { loadConfig } from '../config.js';
import { loadEnv } from '../env.js';
import { startLocalServer } from './local.js';

loadEnv();
const config = loadConfig();
const server = await startLocalServer(config);
console.log(`Sliver server listening on ${server.url}  (WebSocket: ${server.url.replace('http', 'ws')}/ws)`);
console.log(`CORS origins: ${config.allowedOrigins.join(', ') || '(none)'}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
