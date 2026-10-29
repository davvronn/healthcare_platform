import { inject } from 'vitest';

// Runs in every test worker before any app code is imported.
const url = inject('dbUrl');

const { hostname } = new URL(url);
if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
  throw new Error(`Refusing to run DB tests against a non-local database (${hostname})`);
}

process.env.DATABASE_URL = url;
process.env.JWT_SECRET = 'test-secret';
