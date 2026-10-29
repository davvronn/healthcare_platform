import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

/**
 * Starts a throw-away PostgreSQL on a free local port, applies every Prisma
 * migration to it and hands the URL to the test workers. Nothing here ever
 * reads .env, so the Supabase database is never touched.
 */
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'healthcare-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'test',
    password: 'test',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('healthcare_test');

  const client = pg.getPgClient('healthcare_test');
  await client.connect();
  const migrations = join(process.cwd(), 'prisma', 'migrations');
  for (const name of readdirSync(migrations).sort()) {
    if (name.endsWith('.toml')) continue;
    await client.query(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
  }
  await client.end();

  project.provide('dbUrl', `postgresql://test:test@127.0.0.1:${port}/healthcare_test`);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
