import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbApp, type DbApp } from './helpers.js';

describe('Nurse and shared catalogues (real SQL)', () => {
  let t: DbApp;
  beforeAll(async () => (t = await createDbApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const auth = (token: string) => ({ Authorization: token });

  it('reception confirms a pending booking, persists it and notifies the patient', async () => {
    const nurse = await t.seed.nurse();
    const token = await t.login(nurse.email);
    const doc = await t.seed.doctor();
    const pat = await t.seed.patient();
    const appt = await t.seed.appointment(pat.id, doc.id);

    await t.http().patch(`/nurse/appointments/${appt.id}/status`).set(auth(token)).send({ status: 'CONFIRMED' }).expect(200);
    expect((await t.prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('CONFIRMED');
    expect(await t.prisma.notification.count({ where: { userId: pat.id, appointmentId: appt.id } })).toBe(1);

    // no longer pending, and COMPLETED is the doctor's call
    await t.http().patch(`/nurse/appointments/${appt.id}/status`).set(auth(token)).send({ status: 'CANCELLED' }).expect(400);
    const another = await t.seed.appointment(pat.id, doc.id, { appointmentDate: new Date('2030-01-03T10:00:00Z') });
    await t.http().patch(`/nurse/appointments/${another.id}/status`).set(auth(token)).send({ status: 'COMPLETED' }).expect(400);
  });

  it('appointment list filters by doctor and status with totals', async () => {
    const nurse = await t.seed.nurse();
    const token = await t.login(nurse.email);
    const d1 = await t.seed.doctor();
    const d2 = await t.seed.doctor();
    const pat = await t.seed.patient();
    await t.seed.appointment(pat.id, d1.id, { appointmentDate: new Date('2030-01-01T10:00:00Z') });
    await t.seed.appointment(pat.id, d1.id, { appointmentDate: new Date('2030-01-02T10:00:00Z'), status: 'CONFIRMED' });
    await t.seed.appointment(pat.id, d2.id, { appointmentDate: new Date('2030-01-03T10:00:00Z') });

    const all = await t.http().get('/nurse/appointments').set(auth(token)).expect(200);
    expect(all.body.total).toBe(3);
    // ascending by date
    expect(all.body.items.map((a: any) => a.appointmentDate.slice(0, 10))).toEqual(['2030-01-01', '2030-01-02', '2030-01-03']);
    const d1pending = await t.http().get(`/nurse/appointments?doctorId=${d1.id}&status=PENDING`).set(auth(token)).expect(200);
    expect(d1pending.body.total).toBe(1);
  });

  it('patient search matches name or phone, never staff, and hides email', async () => {
    const nurse = await t.seed.nurse();
    const token = await t.login(nurse.email);
    await t.seed.patient({ firstName: 'Maria', lastName: 'Gomez', phone: '+1 555 0100' });
    await t.seed.patient({ firstName: 'John', lastName: 'Smith', phone: '+1 555 0200' });
    await t.seed.doctor({ user: { firstName: 'Maria', lastName: 'Doc' } });

    const byName = await t.http().get('/nurse/patients?search=mar').set(auth(token)).expect(200);
    expect(byName.body.items.map((p: any) => p.lastName)).toEqual(['Gomez']);
    const byPhone = await t.http().get('/nurse/patients?search=0200').set(auth(token)).expect(200);
    expect(byPhone.body.items.map((p: any) => p.lastName)).toEqual(['Smith']);
    expect(JSON.stringify(byName.body)).not.toMatch(/email|passwordHash/);
  });

  it('lab results: list by status, nurse updates are persisted', async () => {
    const nurse = await t.seed.nurse();
    const token = await t.login(nurse.email);
    const pat = await t.seed.patient();
    const rec = await t.prisma.medicalRecord.create({ data: { patientId: pat.id } });
    const pending = await t.prisma.testResult.create({
      data: { recordId: rec.id, testName: 'Blood', testDate: new Date('2030-01-02T09:00:00Z') },
    });
    await t.prisma.testResult.create({
      data: { recordId: rec.id, testName: 'X-ray', testDate: new Date('2030-01-02T10:00:00Z'), status: 'COMPLETED' },
    });

    const list = await t.http().get('/nurse/test-results?status=PENDING').set(auth(token)).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ testName: 'Blood', record: { patient: { id: pat.id } } });

    await t
      .http()
      .patch(`/nurse/test-results/${pending.id}`)
      .set(auth(token))
      .send({ resultDetails: 'Hb 14', status: 'COMPLETED' })
      .expect(200);
    expect(await t.prisma.testResult.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      resultDetails: 'Hb 14',
      status: 'COMPLETED',
      testName: 'Blood',
    });
    await t.http().patch('/nurse/test-results/99999').set(auth(token)).send({ status: 'COMPLETED' }).expect(404);
  });

  it('departments CRUD round trip and diagnoses search', async () => {
    const admin = await t.seed.admin();
    const adminToken = await t.login(admin.email);
    const doc = await t.seed.doctor();
    const docToken = await t.login(doc.email);

    const dept = await t.http().post('/departments').set(auth(adminToken)).send({ departmentName: 'Neurology', location: 'F2' }).expect(201);
    await t.http().patch(`/departments/${dept.body.id}`).set(auth(adminToken)).send({ location: 'F3' }).expect(200);
    const got = await t.http().get(`/departments/${dept.body.id}`).set(auth(docToken)).expect(200);
    expect(got.body).toMatchObject({ departmentName: 'Neurology', location: 'F3', _count: { doctors: 0 } });

    await t.http().post('/diagnoses').set(auth(docToken)).send({ name: 'Migraine' }).expect(201);
    await t.http().post('/diagnoses').set(auth(docToken)).send({ name: 'Influenza' }).expect(201);
    const found = await t.http().get('/diagnoses?search=MIGR').set(auth(docToken)).expect(200);
    expect(found.body.items.map((d: any) => d.name)).toEqual(['Migraine']);
    const all = await t.http().get('/diagnoses').set(auth(docToken)).expect(200);
    expect(all.body.items.map((d: any) => d.name)).toEqual(['Influenza', 'Migraine']); // ordered by name
  });
});
