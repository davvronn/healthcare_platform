import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('Auth', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const registerBody = {
    firstName: 'Ann',
    lastName: 'Lee',
    email: 'Ann@Test.dev',
    password: 'secret123',
  };

  describe('POST /auth/register', () => {
    it('creates a PATIENT, lowercases the email, hashes the password, returns a token', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      t.prisma.user.create.mockResolvedValue({
        id: 1,
        email: 'ann@test.dev',
        role: 'PATIENT',
      });

      const res = await t.http().post('/auth/register').send(registerBody).expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.role).toBe('PATIENT');
      const { data } = t.prisma.user.create.mock.calls[0][0];
      expect(data.role).toBe('PATIENT');
      expect(data.email).toBe('ann@test.dev');
      expect(data.passwordHash).not.toBe('secret123');
      expect(await bcrypt.compare('secret123', data.passwordHash)).toBe(true);
    });

    it('does not let a client choose its role', async () => {
      await t
        .http()
        .post('/auth/register')
        .send({ ...registerBody, role: 'ADMIN' })
        .expect(400);
      expect(t.prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email with 409', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 9 });
      await t.http().post('/auth/register').send(registerBody).expect(409);
    });

    it.each([
      ['bad email', { ...registerBody, email: 'nope' }],
      ['short password', { ...registerBody, password: '123' }],
      ['missing names', { email: 'a@b.dev', password: 'secret123' }],
    ])('rejects invalid input: %s', async (_name, body) => {
      await t.http().post('/auth/register').send(body).expect(400);
    });
  });

  describe('POST /auth/login', () => {
    const user = (over = {}) => ({
      id: 1,
      email: 'ann@test.dev',
      role: 'PATIENT',
      status: 'ACTIVE',
      passwordHash: bcrypt.hashSync('secret123', 4),
      ...over,
    });

    it('returns a token for valid credentials', async () => {
      t.prisma.user.findUnique.mockResolvedValue(user());
      const res = await t
        .http()
        .post('/auth/login')
        .send({ email: 'ann@test.dev', password: 'secret123' })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password with 401', async () => {
      t.prisma.user.findUnique.mockResolvedValue(user());
      await t
        .http()
        .post('/auth/login')
        .send({ email: 'ann@test.dev', password: 'wrong-pass' })
        .expect(401);
    });

    it('rejects an unknown email with 401', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      await t
        .http()
        .post('/auth/login')
        .send({ email: 'x@test.dev', password: 'secret123' })
        .expect(401);
    });

    it('rejects a non-active account with 401', async () => {
      t.prisma.user.findUnique.mockResolvedValue(user({ status: 'BLOCKED' }));
      await t
        .http()
        .post('/auth/login')
        .send({ email: 'ann@test.dev', password: 'secret123' })
        .expect(401);
    });

    it('rejects an invalid body with 400', async () => {
      await t.http().post('/auth/login').send({ email: 'bad' }).expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user', async () => {
      const auth = t.as('PATIENT', 4);
      t.prisma.user.findUnique.mockResolvedValue({ id: 4, email: 'p@test.dev' });
      const res = await t.http().get('/auth/me').set('Authorization', auth).expect(200);
      expect(res.body.id).toBe(4);
      expect(t.prisma.user.findUnique.mock.calls[1][0].where).toEqual({ id: 4 });
    });

    it('requires a token', async () => {
      await t.http().get('/auth/me').expect(401);
    });

    it('rejects a malformed token', async () => {
      await t.http().get('/auth/me').set('Authorization', 'Bearer abc').expect(401);
    });

    it('rejects a token for a blocked user', async () => {
      const auth = t.as('PATIENT', 4, 'BLOCKED');
      await t.http().get('/auth/me').set('Authorization', auth).expect(401);
    });

    it('rejects a token for a deleted user', async () => {
      const auth = t.as('PATIENT', 4);
      t.prisma.user.findUnique.mockReset();
      t.prisma.user.findUnique.mockResolvedValue(null);
      await t.http().get('/auth/me').set('Authorization', auth).expect(401);
    });
  });

  describe('POST /auth/staff', () => {
    const body = {
      firstName: 'Doc',
      lastName: 'Tor',
      email: 'doc@test.dev',
      password: 'secret123',
      role: 'DOCTOR',
      specialization: 'Cardiology',
    };

    it('lets ADMIN create a doctor together with the doctors row', async () => {
      const auth = t.as('ADMIN');
      t.prisma.user.create.mockResolvedValue({ id: 2, role: 'DOCTOR' });
      await t.http().post('/auth/staff').set('Authorization', auth).send(body).expect(201);
      const { data } = t.prisma.user.create.mock.calls[0][0];
      expect(data.role).toBe('DOCTOR');
      expect(data.doctor.create.specialization).toBe('Cardiology');
    });

    it('creates a nurse without a doctors row', async () => {
      const auth = t.as('ADMIN');
      t.prisma.user.create.mockResolvedValue({ id: 2, role: 'NURSE' });
      await t
        .http()
        .post('/auth/staff')
        .set('Authorization', auth)
        .send({ ...body, role: 'NURSE' })
        .expect(201);
      expect(t.prisma.user.create.mock.calls[0][0].data.doctor).toBeUndefined();
    });

    it.each(['PATIENT', 'DOCTOR', 'NURSE'] as const)('forbids %s with 403', async (role) => {
      await t
        .http()
        .post('/auth/staff')
        .set('Authorization', t.as(role))
        .send(body)
        .expect(403);
    });

    it('rejects an unknown role with 400', async () => {
      await t
        .http()
        .post('/auth/staff')
        .set('Authorization', t.as('ADMIN'))
        .send({ ...body, role: 'GOD' })
        .expect(400);
    });
  });
});
