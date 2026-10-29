import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

type Role = 'PATIENT' | 'DOCTOR' | 'NURSE' | 'ADMIN';
const ALL: Role[] = ['PATIENT', 'DOCTOR', 'NURSE', 'ADMIN'];
type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * Access matrix for EVERY route: [method, path pattern, allowed roles].
 * `null` = public. A test below fails if the app registers a route that is
 * missing here, so a new endpoint cannot ship without an access rule.
 */
const matrix: [Method, string, Role[] | null][] = [
  ['get', '/', null],
  ['post', '/auth/register', null],
  ['post', '/auth/login', null],
  ['get', '/auth/me', ALL],
  ['post', '/auth/staff', ['ADMIN']],

  ['get', '/departments', ALL],
  ['get', '/departments/:id', ALL],
  ['post', '/departments', ['ADMIN']],
  ['patch', '/departments/:id', ['ADMIN']],
  ['delete', '/departments/:id', ['ADMIN']],

  ['get', '/diagnoses', ['DOCTOR', 'NURSE', 'ADMIN']],
  ['get', '/diagnoses/:id', ['DOCTOR', 'NURSE', 'ADMIN']],
  ['post', '/diagnoses', ['DOCTOR', 'ADMIN']],
  ['patch', '/diagnoses/:id', ['ADMIN']],
  ['delete', '/diagnoses/:id', ['ADMIN']],

  ['get', '/notifications', ALL],
  ['patch', '/notifications/read-all', ALL],
  ['patch', '/notifications/:id/read', ALL],

  ['get', '/patient/profile', ['PATIENT']],
  ['patch', '/patient/profile', ['PATIENT']],
  ['get', '/patient/departments', ['PATIENT']],
  ['get', '/patient/doctors', ['PATIENT']],
  ['get', '/patient/doctors/:id/schedule', ['PATIENT']],
  ['post', '/patient/appointments', ['PATIENT']],
  ['get', '/patient/appointments', ['PATIENT']],
  ['get', '/patient/appointments/:id', ['PATIENT']],
  ['patch', '/patient/appointments/:id/cancel', ['PATIENT']],
  ['get', '/patient/records', ['PATIENT']],
  ['get', '/patient/records/:id', ['PATIENT']],
  ['get', '/patient/prescriptions', ['PATIENT']],
  ['get', '/patient/test-results', ['PATIENT']],
  ['post', '/patient/feedbacks', ['PATIENT']],
  ['get', '/patient/feedbacks', ['PATIENT']],

  ['get', '/doctor/profile', ['DOCTOR']],
  ['get', '/doctor/appointments', ['DOCTOR']],
  ['get', '/doctor/appointments/:id', ['DOCTOR']],
  ['patch', '/doctor/appointments/:id/status', ['DOCTOR']],
  ['get', '/doctor/patients', ['DOCTOR']],
  ['get', '/doctor/patients/:id/records', ['DOCTOR']],
  ['post', '/doctor/records', ['DOCTOR']],
  ['get', '/doctor/records', ['DOCTOR']],
  ['get', '/doctor/records/:id', ['DOCTOR']],
  ['patch', '/doctor/records/:id', ['DOCTOR']],
  ['post', '/doctor/records/:id/prescriptions', ['DOCTOR']],
  ['patch', '/doctor/prescriptions/:id', ['DOCTOR']],
  ['delete', '/doctor/prescriptions/:id', ['DOCTOR']],
  ['patch', '/doctor/test-results/:id', ['DOCTOR']],
  ['delete', '/doctor/test-results/:id', ['DOCTOR']],
  ['post', '/doctor/records/:id/test-results', ['DOCTOR']],
  ['get', '/doctor/schedule', ['DOCTOR']],
  ['post', '/doctor/schedule', ['DOCTOR']],
  ['delete', '/doctor/schedule/:id', ['DOCTOR']],
  ['get', '/doctor/feedbacks', ['DOCTOR']],

  ['get', '/nurse/appointments', ['NURSE']],
  ['patch', '/nurse/appointments/:id/status', ['NURSE']],
  ['get', '/nurse/patients', ['NURSE']],
  ['get', '/nurse/test-results', ['NURSE']],
  ['patch', '/nurse/test-results/:id', ['NURSE']],

  ['get', '/admin/users', ['ADMIN']],
  ['get', '/admin/users/:id', ['ADMIN']],
  ['patch', '/admin/users/:id', ['ADMIN']],
  ['delete', '/admin/users/:id', ['ADMIN']],
  ['post', '/admin/users/:id/password', ['ADMIN']],
  ['get', '/admin/doctors', ['ADMIN']],
  ['patch', '/admin/doctors/:id', ['ADMIN']],
  ['get', '/admin/doctors/:id/schedule', ['ADMIN']],
  ['post', '/admin/doctors/:id/schedule', ['ADMIN']],
  ['delete', '/admin/doctors/:id/schedule/:scheduleId', ['ADMIN']],
  ['get', '/admin/appointments', ['ADMIN']],
  ['get', '/admin/appointments/:id', ['ADMIN']],
  ['patch', '/admin/appointments/:id', ['ADMIN']],
  ['get', '/admin/feedbacks', ['ADMIN']],
  ['delete', '/admin/feedbacks/:id', ['ADMIN']],
  ['post', '/admin/notifications', ['ADMIN']],
];

const concrete = (path: string) => path.replace(/:\w+/g, '1');

describe('Access control matrix', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const send = (method: Method, path: string, auth?: string) => {
    const req = t.http()[method](concrete(path));
    return auth ? req.set('Authorization', auth).send({}) : req.send({});
  };

  it('covers every route registered in the app (no endpoint without an access rule)', () => {
    const router = (t.app.getHttpAdapter().getInstance() as any).router;
    const registered = router.stack
      .filter((layer: any) => layer.route)
      .flatMap((layer: any) =>
        Object.keys(layer.route.methods).map(
          (m) => `${m.toUpperCase()} ${layer.route.path}`,
        ),
      )
      .sort();
    const declared = matrix
      .map(([m, p]) => `${m.toUpperCase()} ${p}`)
      .sort();

    expect(registered.length).toBeGreaterThan(0);
    expect(declared).toEqual(registered);
  });

  describe.each(matrix)('%s %s', (method, path, roles) => {
    if (roles === null) {
      it('is public (no token needed)', async () => {
        const res = await send(method, path);
        expect(res.status).not.toBe(401);
        expect(res.body.message).not.toBe('Insufficient role');
      });
      return;
    }

    it('401 without a token', async () => {
      await send(method, path).expect(401);
    });

    it.each(ALL.filter((r) => !roles.includes(r)))('403 for %s', async (role) => {
      const res = await send(method, path, t.as(role)).expect(403);
      expect(res.body.message).toBe('Insufficient role');
    });

    // A business-rule 403 (e.g. "Not your patient") still means the role got through.
    it.each(roles)('is reachable by %s', async (role) => {
      const res = await send(method, path, t.as(role));
      expect(res.status).not.toBe(401);
      expect(res.body.message).not.toBe('Insufficient role');
    });
  });
});
