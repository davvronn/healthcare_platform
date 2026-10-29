import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbApp, type DbApp, PASSWORD } from './helpers.js';

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => e.code ?? e.cause?.code ?? e.message,
  );

describe('Database constraints (real SQL)', () => {
  let t: DbApp;
  beforeAll(async () => (t = await createDbApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const auth = (token: string) => ({ Authorization: token });

  describe('schema level', () => {
    it('users.email is unique', async () => {
      await t.seed.patient({ email: 'dup@test.dev' });
      expect(await code(t.seed.patient({ email: 'dup@test.dev' }))).toBe('P2002');
    });

    it('one medical record per appointment', async () => {
      const doc = await t.seed.doctor();
      const pat = await t.seed.patient();
      const appt = await t.seed.appointment(pat.id, doc.id);
      await t.prisma.medicalRecord.create({ data: { patientId: pat.id, appointmentId: appt.id } });
      expect(
        await code(t.prisma.medicalRecord.create({ data: { patientId: pat.id, appointmentId: appt.id } })),
      ).toBe('P2002');
    });

    it('foreign keys reject dangling references', async () => {
      const pat = await t.seed.patient();
      expect(await code(t.seed.appointment(pat.id, 99999))).toBe('P2003');
      expect(
        await code(t.prisma.prescription.create({ data: { recordId: 99999, medicationName: 'x' } })),
      ).toBe('P2003');
      expect(await code(t.prisma.doctor.create({ data: { staffId: 99999 } }))).toBe('P2003');
    });

    it('a user with history cannot be hard-deleted', async () => {
      const doc = await t.seed.doctor();
      const pat = await t.seed.patient();
      await t.seed.appointment(pat.id, doc.id);
      expect(await code(t.prisma.user.delete({ where: { id: pat.id } }))).toBe('P2003');
    });

    it('enum columns reject unknown values', async () => {
      const u = await t.seed.patient();
      const result = await code(
        t.prisma.$executeRawUnsafe(`UPDATE users SET role = 'GOD' WHERE user_id = ${u.id}`),
      );
      expect(result).not.toBe('ok');
    });
  });

  describe('guarded deletes', () => {
    it('department: 409 while it has doctors, then 204', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const dept = await t.seed.department();
      const doc = await t.seed.doctor({ departmentId: dept.id });

      await t.http().delete(`/departments/${dept.id}`).set(auth(token)).expect(409);
      expect(await t.prisma.department.count()).toBe(1);

      await t.prisma.doctor.update({ where: { staffId: doc.id }, data: { departmentId: null } });
      await t.http().delete(`/departments/${dept.id}`).set(auth(token)).expect(204);
      expect(await t.prisma.department.count()).toBe(0);
    });

    it('diagnosis: 409 while used by a record, then 204', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const diagnosis = await t.seed.diagnosis();
      const pat = await t.seed.patient();
      const record = await t.prisma.medicalRecord.create({
        data: { patientId: pat.id, diagnosisId: diagnosis.id },
      });

      await t.http().delete(`/diagnoses/${diagnosis.id}`).set(auth(token)).expect(409);
      await t.prisma.medicalRecord.update({ where: { id: record.id }, data: { diagnosisId: null } });
      await t.http().delete(`/diagnoses/${diagnosis.id}`).set(auth(token)).expect(204);
    });
  });

  describe('admin: users', () => {
    it('lists with real pagination, totals and case-insensitive search', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      for (let i = 0; i < 25; i++) await t.seed.patient({ firstName: i < 3 ? 'Annabel' : 'Bob' });

      const page = await t.http().get('/admin/users?role=PATIENT&limit=10&page=3').set(auth(token)).expect(200);
      expect(page.body).toMatchObject({ total: 25, page: 3, limit: 10 });
      expect(page.body.items).toHaveLength(5);
      expect(JSON.stringify(page.body)).not.toContain('passwordHash');

      const ids = new Set<number>();
      for (const p of [1, 2, 3]) {
        const r = await t.http().get(`/admin/users?role=PATIENT&limit=10&page=${p}`).set(auth(token)).expect(200);
        r.body.items.forEach((u: any) => ids.add(u.id));
      }
      expect(ids.size).toBe(25); // pages neither overlap nor skip rows

      const found = await t.http().get('/admin/users?search=ANNAB').set(auth(token)).expect(200);
      expect(found.body.total).toBe(3);
    });

    it('promoting to DOCTOR creates the doctors row (once)', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const u = await t.seed.nurse();

      await t.http().patch(`/admin/users/${u.id}`).set(auth(token)).send({ role: 'DOCTOR' }).expect(200);
      expect(await t.prisma.doctor.count({ where: { staffId: u.id } })).toBe(1);
      await t.http().patch(`/admin/users/${u.id}`).set(auth(token)).send({ role: 'DOCTOR' }).expect(200);
      expect(await t.prisma.doctor.count({ where: { staffId: u.id } })).toBe(1);
    });

    it('deactivation keeps the row and history but locks the user out immediately', async () => {
      const admin = await t.seed.admin();
      const adminToken = await t.login(admin.email);
      const pat = await t.seed.patient();
      const doc = await t.seed.doctor();
      await t.seed.appointment(pat.id, doc.id);
      const patToken = await t.login(pat.email);
      await t.http().get('/patient/profile').set(auth(patToken)).expect(200);

      await t.http().delete(`/admin/users/${pat.id}`).set(auth(adminToken)).expect(200);

      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: pat.id } })).status).toBe('INACTIVE');
      expect(await t.prisma.appointment.count()).toBe(1);
      await t.http().get('/patient/profile').set(auth(patToken)).expect(401); // old token is dead
      await t.http().post('/auth/login').send({ email: pat.email, password: PASSWORD }).expect(401);
    });

    it('an inactive doctor disappears from the patient catalogue', async () => {
      const admin = await t.seed.admin();
      const adminToken = await t.login(admin.email);
      const pat = await t.seed.patient();
      const patToken = await t.login(pat.email);
      const doc = await t.seed.doctor();

      expect((await t.http().get('/patient/doctors').set(auth(patToken)).expect(200)).body).toHaveLength(1);
      await t.http().patch(`/admin/users/${doc.id}`).set(auth(adminToken)).send({ status: 'BLOCKED' }).expect(200);
      expect((await t.http().get('/patient/doctors').set(auth(patToken)).expect(200)).body).toEqual([]);
    });

    it('an admin cannot lock themselves out', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      await t.http().patch(`/admin/users/${admin.id}`).set(auth(token)).send({ role: 'PATIENT' }).expect(400);
      await t.http().delete(`/admin/users/${admin.id}`).set(auth(token)).expect(400);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
    });

    it('password reset replaces the hash and the new password works', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const pat = await t.seed.patient();

      await t.http().post(`/admin/users/${pat.id}/password`).set(auth(token)).send({ password: 'Another-Pass-1' }).expect(204);
      await t.http().post('/auth/login').send({ email: pat.email, password: PASSWORD }).expect(401);
      await t.http().post('/auth/login').send({ email: pat.email, password: 'Another-Pass-1' }).expect(200);
    });
  });

  describe('auth uniqueness', () => {
    it('emails are unique regardless of case', async () => {
      await t.http().post('/auth/register').send({ firstName: 'A', lastName: 'B', email: 'Case@Test.dev', password: PASSWORD }).expect(201);
      await t.http().post('/auth/register').send({ firstName: 'A', lastName: 'B', email: 'case@test.dev', password: PASSWORD }).expect(409);
      expect(await t.prisma.user.count()).toBe(1);
      // and login is case-insensitive too
      await t.http().post('/auth/login').send({ email: 'CASE@test.DEV', password: PASSWORD }).expect(200);
    });

    it('creating a doctor is atomic: user and doctors row together', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      await t
        .http()
        .post('/auth/staff')
        .set(auth(token))
        .send({ firstName: 'D', lastName: 'R', email: 'dr@test.dev', password: PASSWORD, role: 'DOCTOR' })
        .expect(201);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'dr@test.dev' }, include: { doctor: true } });
      expect(user.role).toBe('DOCTOR');
      expect(user.doctor?.staffId).toBe(user.id);
    });
  });

  describe('admin: appointments, feedback, schedule, notifications', () => {
    it('filters appointments by status/doctor/patient/date range with a real total', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const d1 = await t.seed.doctor();
      const d2 = await t.seed.doctor();
      const p1 = await t.seed.patient();
      const p2 = await t.seed.patient();
      await t.seed.appointment(p1.id, d1.id, { appointmentDate: new Date('2030-01-01T10:00:00Z'), status: 'PENDING' });
      await t.seed.appointment(p1.id, d2.id, { appointmentDate: new Date('2030-02-01T10:00:00Z'), status: 'COMPLETED' });
      await t.seed.appointment(p2.id, d1.id, { appointmentDate: new Date('2030-03-01T10:00:00Z'), status: 'PENDING' });

      const q = async (qs: string) =>
        (await t.http().get(`/admin/appointments?${qs}`).set(auth(token)).expect(200)).body;
      expect((await q('')).total).toBe(3);
      expect((await q('status=PENDING')).total).toBe(2);
      expect((await q(`doctorId=${d1.id}`)).total).toBe(2);
      expect((await q(`patientId=${p1.id}&status=PENDING`)).total).toBe(1);
      expect((await q('from=2030-01-15T00:00:00Z&to=2030-02-15T00:00:00Z')).total).toBe(1);
      expect((await q('limit=2')).items).toHaveLength(2);
    });

    it('admin schedule management and feedback moderation hit the right rows', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const doc = await t.seed.doctor();
      const pat = await t.seed.patient();

      const slot = await t
        .http()
        .post(`/admin/doctors/${doc.id}/schedule`)
        .set(auth(token))
        .send({ workDate: '2030-05-01', startTime: '08:00', endTime: '12:00' })
        .expect(201);
      expect((await t.http().get(`/admin/doctors/${doc.id}/schedule`).set(auth(token)).expect(200)).body).toHaveLength(1);
      await t.http().delete(`/admin/doctors/${doc.id}/schedule/${slot.body.id}`).set(auth(token)).expect(204);
      expect(await t.prisma.schedule.count()).toBe(0);
      await t.http().post('/admin/doctors/99999/schedule').set(auth(token)).send({ workDate: '2030-05-01', startTime: '08:00', endTime: '12:00' }).expect(404);

      const fb = await t.prisma.feedback.create({ data: { patientId: pat.id, doctorId: doc.id, rating: 2 } });
      expect((await t.http().get(`/admin/feedbacks?doctorId=${doc.id}`).set(auth(token)).expect(200)).body.total).toBe(1);
      await t.http().delete(`/admin/feedbacks/${fb.id}`).set(auth(token)).expect(204);
      expect(await t.prisma.feedback.count()).toBe(0);
      await t.http().delete(`/admin/feedbacks/${fb.id}`).set(auth(token)).expect(404);
    });

    it('admin notification is stored for the target user', async () => {
      const admin = await t.seed.admin();
      const token = await t.login(admin.email);
      const pat = await t.seed.patient();
      await t.http().post('/admin/notifications').set(auth(token)).send({ userId: pat.id, title: 'Maintenance', message: 'Tonight' }).expect(201);
      const patToken = await t.login(pat.email);
      const mine = await t.http().get('/notifications').set(auth(patToken)).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({ title: 'Maintenance', message: 'Tonight', isRead: false });
    });
  });
});
