import { attachDatabasePool } from '@neon/functions';
import { upgradeWebSocket } from '@neon/functions/hono';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { createApp } from '../http/app.js';
import { ServerClock } from '../realtime/clock.js';
import { Hub } from '../realtime/hub.js';

/**
 * Neon Functions entry point (deployed by `neon deploy`, see /neon.ts).
 *
 * Module scope runs once per isolate: one pg pool, one Hub. DATABASE_URL is
 * injected by Neon from the branch; ALLOWED_ORIGINS comes from the deploy.
 */
const config = loadConfig(process.env);
const { db, pool } = createDatabase(config.databaseUrl, config.dbPoolMax);
// Without an error listener, an idle connection dropped by scale-to-zero would crash the isolate.
attachDatabasePool(pool);

const hub = new Hub({ db, config, clock: new ServerClock(pool) });
hub.start();
process.once('SIGINT', () => hub.stop());

export default createApp({ db, config, hub, upgradeWebSocket });
