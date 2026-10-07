import { loadEnv } from '../src/env.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_DB_DEFAULT = 'postgresql://sliver:sliver@localhost:5434/sliver_test';

export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL ?? TEST_DB_DEFAULT;
  await runMigrations(url);
}
