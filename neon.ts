import { defineConfig } from '@neon/config/v1';

/**
 * Neon backend for Sliver, applied with `neon deploy` (see README → Deploy).
 *
 * Postgres is always present on the branch, so DATABASE_URL is injected into
 * the function automatically. The values below are read from your shell (or
 * `neon deploy --env .env.production`) at deploy time.
 */
export default defineConfig({
  functions: {
    // The key is the permanent slug: it becomes part of the function URL.
    sliver: {
      name: 'Sliver game server',
      source: './apps/server/src/entry/neon.ts',
      env: {
        // Your Vercel URL(s), comma-separated, e.g. https://sliver.vercel.app
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '',
        MAX_PLAYERS_PER_ROOM: process.env.MAX_PLAYERS_PER_ROOM ?? '50',
      },
    },
  },
});
