import { resolve } from 'node:path';
import { loadCatalog } from './library/catalog.js';
import { buildApp } from './app.js';
const tracks = await loadCatalog(resolve(process.env.MEDIA_DIR ?? '../media'));
const { app } = await buildApp(tracks, { logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
