import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbApp, type DbApp } from './helpers.js';

/**
 * Two doctors and two patients with data of their own: checks, against real
 * SQL, that every where-clause really keeps users inside their own data.
 */
describe('Data isolation (real SQL)', () => {
  let t: DbApp;
  beforeAll(async () => (t = await createDbApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const auth = (token: string) => ({ Authorization: token });

  async function world() {
    const docA = await t.seed.doctor();
    const docB = await t.seed.doctor({ specialization: 'Dermatology' });
    const patA = await t.seed.patient();
    const patB = await t.seed.patient();

    const apptA = await t.seed.appointment(patA.id, docA.id, { status: 'COMPLETED' });
    const apptB = await t.seed.appointment(patB.id, docB.id, {
      appointmentDate: new Date('2030-01-02T11:00:00Z'),
      status: 'COMPLETED',
    });
    const recA = await t.prisma.medicalRecord.create({
      data: {
        patientId: patA.id,
        appointmentId: apptA.id,
        treatment: 'A-secret',
        prescriptions: { create: [{ medicationName: 'A-drug' }] },
        testResults: { create: [{ testName: 'A-test', testDate: new Date('2030-01-02T12:00:00Z') }] },
      },
      include: { prescriptions: true, testResults: true },
    });
    const recB = await t.prisma.medicalRecord.create({
      data: { patientId: patB.id, appointmentId: apptB.id, treatment: 'B-secret' },
    });
    const schedA = await t.prisma.schedule.create({
      data: {
        doctorId: docA.id,
        workDate: new Date('2030-01-02'),
        startTime: new Date('1970-01-01T09:00:00Z'),
        endTime: new Date('1970-01-01T17:00:00Z'),
      },
    });

    return {
      docA, docB, patA, patB, apptA, apptB, recA, recB, schedA,
      a: { doc: await t.login(docA.email), pat: await t.login(patA.email) },
      b: { doc: await t.login(docB.email), pat: await t.login(patB.email) },
    };
  }

  describe('patients', () => {
    it('see only their own appointments and records', async () => {
      const w = await world();

      const appts = await t.http().get('/patient/appointments').set(auth(w.a.pat)).expect(200);
      expect(appts.body.map((x: any) => x.id)).toEqual([w.apptA.id]);

      const recs = await t.http().get('/patient/records').set(auth(w.a.pat)).expect(200);
      expect(recs.body.map((x: any) => x.treatment)).toEqual(['A-secret']);

      await t.http().get(`/patient/appointments/${w.apptB.id}`).set(auth(w.a.pat)).expect(404);
      await t.http().get(`/patient/records/${w.recB.id}`).set(auth(w.a.pat)).expect(404);
      await t.http().get(`/patient/records/${w.recA.id}`).set(auth(w.a.pat)).expect(200);
    });

    it('cannot see or cancel appointments of others', async () => {
      const w = await world();
      await t.http().patch(`/patient/appointments/${w.apptB.id}/cancel`).set(auth(w.a.pat)).expect(404);
      expect((await t.prisma.appointment.findUniqueOrThrow({ where: { id: w.apptB.id } })).status).toBe('COMPLETED');
    });

    it('prescriptions and test results are filtered through the record owner', async () => {
      const w = await world();
      await t.prisma.prescription.create({ data: { recordId: w.recB.id, medicationName: 'B-drug' } });

      const rx = await t.http().get('/patient/prescriptions').set(auth(w.a.pat)).expect(200);
      expect(rx.body.map((x: any) => x.medicationName)).toEqual(['A-drug']);
      const tests = await t.http().get('/patient/test-results').set(auth(w.b.pat)).expect(200);
      expect(tests.body).toEqual([]);
    });

    it('feedback list shows only own reviews', async () => {
      const w = await world();
      await t.prisma.feedback.createMany({
        data: [
          { patientId: w.patA.id, doctorId: w.docA.id, rating: 5 },
          { patientId: w.patB.id, doctorId: w.docB.id, rating: 1 },
        ],
      });
      const res = await t.http().get('/patient/feedbacks').set(auth(w.a.pat)).expect(200);
      expect(res.body.map((x: any) => x.rating)).toEqual([5]);
    });

    it('profile updates change only the caller', async () => {
      const w = await world();
      await t.http().patch('/patient/profile').set(auth(w.a.pat)).send({ phone: '111' }).expect(200);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: w.patA.id } })).phone).toBe('111');
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: w.patB.id } })).phone).toBeNull();
    });
  });

  describe('doctors', () => {
    it('see only their own appointments', async () => {
      const w = await world();
      const list = await t.http().get('/doctor/appointments').set(auth(w.a.doc)).expect(200);
      expect(list.body.map((x: any) => x.id)).toEqual([w.apptA.id]);
      await t.http().get(`/doctor/appointments/${w.apptB.id}`).set(auth(w.a.doc)).expect(404);
      await t
        .http()
        .patch(`/doctor/appointments/${w.apptB.id}/status`)
        .set(auth(w.a.doc))
        .send({ status: 'CANCELLED' })
        .expect(404);
    });

    it('list only patients they treated and only read their history', async () => {
      const w = await world();
      const patients = await t.http().get('/doctor/patients').set(auth(w.a.doc)).expect(200);
      expect(patients.body.map((x: any) => x.id)).toEqual([w.patA.id]);

      await t.http().get(`/doctor/patients/${w.patA.id}/records`).set(auth(w.a.doc)).expect(200);
      await t.http().get(`/doctor/patients/${w.patB.id}/records`).set(auth(w.a.doc)).expect(403);
    });

    it("cannot read or change another doctor's records, prescriptions and tests", async () => {
      const w = await world();
      const rxA = w.recA.prescriptions[0].id;
      const testA = w.recA.testResults[0].id;

      const mine = await t.http().get('/doctor/records').set(auth(w.b.doc)).expect(200);
      expect(mine.body.map((x: any) => x.treatment)).toEqual(['B-secret']);

      await t.http().get(`/doctor/records/${w.recA.id}`).set(auth(w.b.doc)).expect(404);
      await t.http().patch(`/doctor/records/${w.recA.id}`).set(auth(w.b.doc)).send({ treatment: 'hacked' }).expect(404);
      await t.http().post(`/doctor/records/${w.recA.id}/prescriptions`).set(auth(w.b.doc)).send({ medicationName: 'x' }).expect(404);
      await t.http().patch(`/doctor/prescriptions/${rxA}`).set(auth(w.b.doc)).send({ dosage: 'x' }).expect(404);
      await t.http().delete(`/doctor/prescriptions/${rxA}`).set(auth(w.b.doc)).expect(404);
      await t.http().patch(`/doctor/test-results/${testA}`).set(auth(w.b.doc)).send({ status: 'COMPLETED' }).expect(404);
      await t.http().delete(`/doctor/test-results/${testA}`).set(auth(w.b.doc)).expect(404);

      // nothing changed in the database
      const rec = await t.prisma.medicalRecord.findUniqueOrThrow({
        where: { id: w.recA.id },
        include: { prescriptions: true, testResults: true },
      });
      expect(rec.treatment).toBe('A-secret');
      expect(rec.prescriptions).toHaveLength(1);
      expect(rec.testResults).toHaveLength(1);
    });

    it('cannot write a record for an appointment of another doctor', async () => {
      const w = await world();
      const fresh = await t.seed.appointment(w.patA.id, w.docA.id, {
        appointmentDate: new Date('2030-01-03T10:00:00Z'),
      });
      await t.http().post('/doctor/records').set(auth(w.b.doc)).send({ appointmentId: fresh.id }).expect(404);
      expect(await t.prisma.medicalRecord.count({ where: { appointmentId: fresh.id } })).toBe(0);
    });

    it("cannot delete another doctor's schedule slot", async () => {
      const w = await world();
      await t.http().delete(`/doctor/schedule/${w.schedA.id}`).set(auth(w.b.doc)).expect(404);
      expect(await t.prisma.schedule.count()).toBe(1);
      await t.http().delete(`/doctor/schedule/${w.schedA.id}`).set(auth(w.a.doc)).expect(204);
      expect(await t.prisma.schedule.count()).toBe(0);
    });

    it('feedback list is limited to the doctor', async () => {
      const w = await world();
      await t.prisma.feedback.createMany({
        data: [
          { patientId: w.patA.id, doctorId: w.docA.id, rating: 5 },
          { patientId: w.patB.id, doctorId: w.docB.id, rating: 1 },
        ],
      });
      const res = await t.http().get('/doctor/feedbacks').set(auth(w.a.doc)).expect(200);
      expect(res.body).toMatchObject({ total: 1, averageRating: 5 });
    });
  });

  describe('notifications', () => {
    it('are readable and markable only by their owner', async () => {
      const w = await world();
      const n = await t.prisma.notification.create({ data: { userId: w.patA.id, title: 'For A' } });

      expect((await t.http().get('/notifications').set(auth(w.b.pat)).expect(200)).body).toEqual([]);
      await t.http().patch(`/notifications/${n.id}/read`).set(auth(w.b.pat)).expect(404);
      expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(false);

      await t.http().patch(`/notifications/${n.id}/read`).set(auth(w.a.pat)).expect(200);
      expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(true);
    });

    it('read-all touches only the caller', async () => {
      const w = await world();
      await t.prisma.notification.createMany({
        data: [
          { userId: w.patA.id, title: '1' },
          { userId: w.patA.id, title: '2' },
          { userId: w.patB.id, title: '3' },
        ],
      });
      const res = await t.http().patch('/notifications/read-all').set(auth(w.a.pat)).expect(200);
      expect(res.body).toEqual({ updated: 2 });
      expect(await t.prisma.notification.count({ where: { isRead: false } })).toBe(1);
    });
  });
});
