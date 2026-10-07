import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * Local entry points and scripts load `.env.local` first, then `.env`
 * (from apps/server). Never imported by the Neon Functions entry: there the
 * platform injects DATABASE_URL and the deploy carries the rest.
 */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) config({ path: file, override: false, quiet: true });
  }
}
