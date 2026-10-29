import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('App (public routes)', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());

  it('GET / is public', async () => {
    const res = await t.http().get('/').expect(200);
    expect(res.text).toBe('Hello World!');
  });

  it('unknown route returns 404', async () => {
    await t.http().get('/nope').expect(404);
  });
});
