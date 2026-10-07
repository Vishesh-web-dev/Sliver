import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import type { ServerConfig } from '../config.js';
import { createDatabase, type Database } from '../db/client.js';
import { createApp } from '../http/app.js';
import { ServerClock } from '../realtime/clock.js';
import { Hub } from '../realtime/hub.js';

export interface LocalServer extends Database {
  hub: Hub;
  server: ServerType;
  url: string;
  close(): Promise<void>;
}

/**
 * Runs the exact same app on plain Node with @hono/node-ws standing in for the
 * Neon Functions WebSocket adapter. Used by `npm run dev` and by the tests.
 */
export async function startLocalServer(config: ServerConfig, port = config.port): Promise<LocalServer> {
  const database = createDatabase(config.databaseUrl, config.dbPoolMax);
  const hub = new Hub({ db: database.db, config, clock: new ServerClock(database.pool) });

  const root = new Hono();
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app: root });
  root.route('/', createApp({ db: database.db, config, hub, upgradeWebSocket }));

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: root.fetch, port }, () => resolve(s));
  });
  injectWebSocket(server);
  hub.start();

  const address = server.address() as AddressInfo;
  return {
    ...database,
    hub,
    server,
    url: `http://localhost:${address.port}`,
    async close() {
      hub.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.pool.end();
    },
  };
}
