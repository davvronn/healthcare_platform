import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbApp, type DbApp, PASSWORD } from './helpers.js';

/**
 * One clinic story through the real HTTP API and a real PostgreSQL:
 * admin sets up a doctor -> patient books -> doctor treats -> patient reviews.
 */
describe('Clinic lifecycle (real SQL)', () => {
  let t: DbApp;
  beforeAll(async () => (t = await createDbApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const auth = (token: string) => ({ Authorization: token });

  async function setup() {
    const admin = await t.seed.admin();
    const adminAuth = await t.login(admin.email);

    const dept = (
      await t.http().post('/departments').set(auth(adminAuth)).send({ departmentName: 'Cardiology' }).expect(201)
    ).body;

    const staff = await t
      .http()
      .post('/auth/staff')
      .set(auth(adminAuth))
      .send({
        firstName: 'Greg',
        lastName: 'House',
        email: 'house@test.dev',
        password: PASSWORD,
        role: 'DOCTOR',
        specialization: 'Cardiology',
        licenseNumber: 'LIC-1',
      })
      .expect(201);
    const doctorId: number = staff.body.id;
    await t.http().patch(`/admin/doctors/${doctorId}`).set(auth(adminAuth)).send({ departmentId: dept.id }).expect(200);
    const doctorAuth = await t.login('house@test.dev');

    await t
      .http()
      .post('/doctor/schedule')
      .set(auth(doctorAuth))
      .send({ workDate: '2030-01-02', startTime: '09:00', endTime: '17:00' })
      .expect(201);

    const reg = await t
      .http()
      .post('/auth/register')
      .send({ firstName: 'Ann', lastName: 'Lee', email: 'ann@test.dev', password: PASSWORD })
      .expect(201);
    const patientAuth = `Bearer ${reg.body.accessToken}`;
    const patientId: number = reg.body.user.id;

    return { adminAuth, dept, doctorId, doctorAuth, patientAuth, patientId };
  }

  const book = (patientAuth: string, doctorId: number, at = '2030-01-02T10:00:00.000Z') =>
    t.http().post('/patient/appointments').set(auth(patientAuth)).send({ doctorId, appointmentDate: at, reason: 'Chest pain' });

  it('registration and staff creation write the right rows', async () => {
    const { doctorId, patientId } = await setup();

    const patient = await t.prisma.user.findUniqueOrThrow({ where: { id: patientId } });
    expect(patient.role).toBe('PATIENT');
    expect(patient.passwordHash).not.toBe(PASSWORD);

    const doctor = await t.prisma.doctor.findUniqueOrThrow({
      where: { staffId: doctorId },
      include: { user: true, department: true },
    });
    expect(doctor.user.role).toBe('DOCTOR');
    expect(doctor.licenseNumber).toBe('LIC-1');
    expect(doctor.department?.departmentName).toBe('Cardiology');
  });

  it('schedule HH:mm values survive the TIME column round trip', async () => {
    const { doctorAuth } = await setup();
    const res = await t.http().get('/doctor/schedule').set(auth(doctorAuth)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].workDate).toBe('2030-01-02T00:00:00.000Z');
    expect(res.body[0].startTime).toBe('1970-01-01T09:00:00.000Z');
    expect(res.body[0].endTime).toBe('1970-01-01T17:00:00.000Z');
  });

  it('catalogue: doctors are searchable (case-insensitive) with department and rating', async () => {
    const { patientAuth, doctorId } = await setup();
    const res = await t.http().get('/patient/doctors?specialization=CARDIO').set(auth(patientAuth)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      staffId: doctorId,
      averageRating: null,
      feedbackCount: 0,
      department: { departmentName: 'Cardiology' },
      user: { firstName: 'Greg' },
    });
    // The catalogue never leaks private fields.
    expect(JSON.stringify(res.body)).not.toMatch(/email|licenseNumber|passwordHash/);

    const none = await t.http().get('/patient/doctors?specialization=dermatology').set(auth(patientAuth)).expect(200);
    expect(none.body).toEqual([]);
  });

  it('booking: stores the slot, rejects a double booking and out-of-hours times', async () => {
    const { patientAuth, doctorId, patientId } = await setup();

    const ok = await book(patientAuth, doctorId).expect(201);
    const row = await t.prisma.appointment.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(row).toMatchObject({ patientId, doctorId, status: 'PENDING', reason: 'Chest pain' });
    expect(row.appointmentDate.toISOString()).toBe('2030-01-02T10:00:00.000Z');

    await book(patientAuth, doctorId).expect(409);
    await book(patientAuth, doctorId, '2030-01-02T17:00:00.000Z').expect(400); // end is exclusive
    await book(patientAuth, doctorId, '2030-01-02T08:59:00.000Z').expect(400);
    await book(patientAuth, doctorId, '2030-01-03T10:00:00.000Z').expect(400); // no schedule that day
    expect(await t.prisma.appointment.count()).toBe(1);
  });

  it('a cancelled slot can be booked again', async () => {
    const { patientAuth, doctorId } = await setup();
    const first = await book(patientAuth, doctorId).expect(201);
    await t.http().patch(`/patient/appointments/${first.body.id}/cancel`).set(auth(patientAuth)).expect(200);
    await book(patientAuth, doctorId).expect(201);

    const rows = await t.prisma.appointment.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['CANCELLED', 'PENDING']);
  });

  it('notifications are created for both sides and are private', async () => {
    const { patientAuth, doctorAuth, doctorId } = await setup();
    const appt = await book(patientAuth, doctorId).expect(201);

    // doctor was told about the new booking
    const inbox = await t.http().get('/notifications?unread=true').set(auth(doctorAuth)).expect(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0]).toMatchObject({ userId: doctorId, appointmentId: appt.body.id, isRead: false });

    // the patient sees nothing of it
    const mine = await t.http().get('/notifications').set(auth(patientAuth)).expect(200);
    expect(mine.body).toEqual([]);
    await t.http().patch(`/notifications/${inbox.body[0].id}/read`).set(auth(patientAuth)).expect(404);

    // doctor marks it read
    await t.http().patch(`/notifications/${inbox.body[0].id}/read`).set(auth(doctorAuth)).expect(200);
    const unread = await t.http().get('/notifications?unread=true').set(auth(doctorAuth)).expect(200);
    expect(unread.body).toEqual([]);

    // confirming notifies the patient
    await t
      .http()
      .patch(`/doctor/appointments/${appt.body.id}/status`)
      .set(auth(doctorAuth))
      .send({ status: 'CONFIRMED' })
      .expect(200);
    const patientInbox = await t.http().get('/notifications').set(auth(patientAuth)).expect(200);
    expect(patientInbox.body).toHaveLength(1);
    expect(patientInbox.body[0].title).toBe('Appointment confirmed');

    // read-all
    await t.http().patch('/notifications/read-all').set(auth(patientAuth)).expect(200);
    expect(await t.prisma.notification.count({ where: { isRead: false, userId: { not: doctorId } } })).toBe(0);
  });

  it('treatment: record with prescriptions and test results, visible to the patient', async () => {
    const { patientAuth, doctorAuth, doctorId, patientId } = await setup();
    const flu = await t.seed.diagnosis('Hypertension');
    const appt = await book(patientAuth, doctorId).expect(201);
    const id: number = appt.body.id;

    for (const status of ['CONFIRMED', 'COMPLETED']) {
      await t.http().patch(`/doctor/appointments/${id}/status`).set(auth(doctorAuth)).send({ status }).expect(200);
    }
    // finished appointments cannot be reopened
    await t.http().patch(`/doctor/appointments/${id}/status`).set(auth(doctorAuth)).send({ status: 'CONFIRMED' }).expect(400);

    const rec = await t
      .http()
      .post('/doctor/records')
      .set(auth(doctorAuth))
      .send({
        appointmentId: id,
        diagnosisId: flu.id,
        treatment: 'Rest and medication',
        prescriptions: [
          { medicationName: 'Lisinopril', dosage: '10mg', frequency: 'daily', duration: '30 days' },
          { medicationName: 'Aspirin', dosage: '75mg' },
        ],
      })
      .expect(201);
    // one record per appointment
    await t.http().post('/doctor/records').set(auth(doctorAuth)).send({ appointmentId: id }).expect(409);

    await t
      .http()
      .post(`/doctor/records/${rec.body.id}/test-results`)
      .set(auth(doctorAuth))
      .send({ testName: 'ECG', testDate: '2030-01-02T11:00:00Z', resultDetails: 'Normal', status: 'COMPLETED' })
      .expect(201);

    // patientId on the record comes from the appointment, not from the client
    const stored = await t.prisma.medicalRecord.findUniqueOrThrow({ where: { id: rec.body.id } });
    expect(stored.patientId).toBe(patientId);
    expect(stored.appointmentId).toBe(id);

    const mine = await t.http().get('/patient/records').set(auth(patientAuth)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      treatment: 'Rest and medication',
      diagnosis: { name: 'Hypertension' },
      appointment: { id, doctor: { staffId: doctorId, user: { firstName: 'Greg' } } },
    });
    expect(mine.body[0].prescriptions.map((p: any) => p.medicationName).sort()).toEqual(['Aspirin', 'Lisinopril']);
    expect(mine.body[0].testResults).toHaveLength(1);

    const prescriptions = await t.http().get('/patient/prescriptions').set(auth(patientAuth)).expect(200);
    expect(prescriptions.body).toHaveLength(2);
    const tests = await t.http().get('/patient/test-results').set(auth(patientAuth)).expect(200);
    expect(tests.body[0]).toMatchObject({ testName: 'ECG', status: 'COMPLETED' });
  });

  it('feedback: only after a completed visit, once per doctor, and it feeds the rating', async () => {
    const { patientAuth, doctorAuth, doctorId } = await setup();
    const review = { doctorId, rating: 4, comment: 'Thorough' };

    await t.http().post('/patient/feedbacks').set(auth(patientAuth)).send(review).expect(400); // no visit yet

    const appt = await book(patientAuth, doctorId).expect(201);
    for (const status of ['CONFIRMED', 'COMPLETED']) {
      await t.http().patch(`/doctor/appointments/${appt.body.id}/status`).set(auth(doctorAuth)).send({ status }).expect(200);
    }

    await t.http().post('/patient/feedbacks').set(auth(patientAuth)).send(review).expect(201);
    await t.http().post('/patient/feedbacks').set(auth(patientAuth)).send(review).expect(409);

    // a second patient with a completed visit raises the average
    const other = await t.seed.patient();
    await t.seed.appointment(other.id, doctorId, {
      appointmentDate: new Date('2030-01-02T12:00:00Z'),
      status: 'COMPLETED',
    });
    const otherAuth = await t.login(other.email);
    await t.http().post('/patient/feedbacks').set(auth(otherAuth)).send({ doctorId, rating: 5 }).expect(201);

    const catalogue = await t.http().get('/patient/doctors').set(auth(patientAuth)).expect(200);
    expect(catalogue.body[0]).toMatchObject({ averageRating: 4.5, feedbackCount: 2 });

    const mine = await t.http().get('/doctor/feedbacks').set(auth(doctorAuth)).expect(200);
    expect(mine.body).toMatchObject({ averageRating: 4.5, total: 2 });
    expect(mine.body.items).toHaveLength(2);
  });
});
