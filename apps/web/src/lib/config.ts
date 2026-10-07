/** Where the game server lives. Set VITE_API_URL at build time (see apps/web/.env.example). */
const raw = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

export const API_URL = raw.replace(/\/+$/, '');
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/ws`;
