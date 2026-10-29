import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

const ME = 3;
const DOC = 5;
const FUTURE = '2030-01-02T10:00:00.000Z';

describe('Patient API (/patient)', () => {
  let t: TestApp;
  let auth: string;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => {
    t.reset();
    auth = t.as('PATIENT', ME);
  });

  const get = (path: string) => t.http().get(path).set('Authorization', auth);
  const post = (path: string, body?: object) =>
    t.http().post(path).set('Authorization', auth).send(body);
  const patch = (path: string, body?: object) =>
    t.http().patch(path).set('Authorization', auth).send(body);

  describe('/patient/profile', () => {
    it('GET returns own profile', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: ME });
      await get('/patient/profile').expect(200);
      expect(t.prisma.user.findUnique.mock.calls[1][0].where).toEqual({ id: ME });
    });
    it('PATCH updates own profile only', async () => {
      t.prisma.user.update.mockResolvedValue({ id: ME, phone: '123' });
      await patch('/patient/profile', { phone: '123' }).expect(200);
      expect(t.prisma.user.update.mock.calls[0][0].where).toEqual({ id: ME });
    });
    it('PATCH cannot change role, email or status', async () => {
      await patch('/patient/profile', { role: 'ADMIN' }).expect(400);
      auth = t.as('PATIENT', ME); // each request consumes one queued guard lookup
      await patch('/patient/profile', { email: 'x@y.dev' }).expect(400);
      expect(t.prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /patient/departments', () => {
    it('lists departments', async () => {
      t.prisma.department.findMany.mockResolvedValue([{ id: 1 }]);
      const res = await get('/patient/departments').expect(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /patient/doctors', () => {
    it('lists active doctors with their average rating', async () => {
      t.prisma.doctor.findMany.mockResolvedValue([{ staffId: DOC }, { staffId: 6 }]);
      t.prisma.feedback.groupBy.mockResolvedValue([
        { doctorId: DOC, _avg: { rating: 4 }, _count: 2 },
      ]);
      const res = await get('/patient/doctors').expect(200);
      expect(res.body[0]).toMatchObject({ staffId: DOC, averageRating: 4, feedbackCount: 2 });
      expect(res.body[1]).toMatchObject({ staffId: 6, averageRating: null, feedbackCount: 0 });
      expect(t.prisma.doctor.findMany.mock.calls[0][0].where.user).toEqual({ status: 'ACTIVE' });
    });
    it('applies department and specialization filters', async () => {
      t.prisma.doctor.findMany.mockResolvedValue([]);
      t.prisma.feedback.groupBy.mockResolvedValue([]);
      await get('/patient/doctors?departmentId=2&specialization=cardio').expect(200);
      const { where } = t.prisma.doctor.findMany.mock.calls[0][0];
      expect(where.departmentId).toBe(2);
      expect(where.specialization.contains).toBe('cardio');
    });
    it('400 for a non-numeric departmentId', async () => {
      await get('/patient/doctors?departmentId=abc').expect(400);
    });
  });

  describe('GET /patient/doctors/:id/schedule', () => {
    it('returns upcoming slots', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.schedule.findMany.mockResolvedValue([{ id: 1 }]);
      await get(`/patient/doctors/${DOC}/schedule`).expect(200);
    });
    it('404 for an unknown or inactive doctor', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue(null);
      await get(`/patient/doctors/${DOC}/schedule`).expect(404);
    });
  });

  describe('POST /patient/appointments', () => {
    const body = { doctorId: DOC, appointmentDate: FUTURE, reason: 'Checkup' };
    const workingDay = () => [
      {
        startTime: new Date('1970-01-01T09:00:00Z'),
        endTime: new Date('1970-01-01T17:00:00Z'),
      },
    ];

    it('books a slot and notifies the doctor', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.schedule.findMany.mockResolvedValue(workingDay());
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      t.prisma.appointment.create.mockResolvedValue({ id: 10 });
      await post('/patient/appointments', body).expect(201);
      const { data } = t.prisma.appointment.create.mock.calls[0][0];
      expect(data).toMatchObject({ patientId: ME, doctorId: DOC });
      expect(t.prisma.notification.create.mock.calls[0][0].data.userId).toBe(DOC);
    });
    it('400 for a time in the past', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      await post('/patient/appointments', { ...body, appointmentDate: '2020-01-01T10:00:00Z' }).expect(400);
    });
    it('400 outside the doctor working hours', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.schedule.findMany.mockResolvedValue(workingDay());
      await post('/patient/appointments', { ...body, appointmentDate: '2030-01-02T18:00:00Z' }).expect(400);
    });
    it('400 on a day without a schedule', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.schedule.findMany.mockResolvedValue([]);
      await post('/patient/appointments', body).expect(400);
    });
    it('409 when the slot is taken', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.schedule.findMany.mockResolvedValue(workingDay());
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 99 });
      await post('/patient/appointments', body).expect(409);
      expect(t.prisma.appointment.create).not.toHaveBeenCalled();
    });
    it('404 for an unknown doctor', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue(null);
      await post('/patient/appointments', body).expect(404);
    });
    it('400 when booking yourself', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: ME });
      await post('/patient/appointments', { ...body, doctorId: ME }).expect(400);
    });
    it('400 for an invalid body', async () => {
      await post('/patient/appointments', { doctorId: 'x', appointmentDate: 'tomorrow' }).expect(400);
    });
    it('400 when patientId is supplied by the client', async () => {
      await post('/patient/appointments', { ...body, patientId: 1 }).expect(400);
    });
  });

  describe('GET /patient/appointments', () => {
    it('lists only own appointments', async () => {
      t.prisma.appointment.findMany.mockResolvedValue([]);
      await get('/patient/appointments').expect(200);
      expect(t.prisma.appointment.findMany.mock.calls[0][0].where.patientId).toBe(ME);
    });
    it('filters by status', async () => {
      t.prisma.appointment.findMany.mockResolvedValue([]);
      await get('/patient/appointments?status=PENDING').expect(200);
      expect(t.prisma.appointment.findMany.mock.calls[0][0].where.status).toBe('PENDING');
    });
    it('400 for an invalid status', async () => {
      await get('/patient/appointments?status=x').expect(400);
    });
  });

  describe('GET /patient/appointments/:id', () => {
    it('returns an own appointment', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 8 });
      await get('/patient/appointments/8').expect(200);
      expect(t.prisma.appointment.findFirst.mock.calls[0][0].where).toEqual({ id: 8, patientId: ME });
    });
    it("404 for someone else's appointment", async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await get('/patient/appointments/8').expect(404);
    });
  });

  describe('PATCH /patient/appointments/:id/cancel', () => {
    const appt = (status: string) => ({
      id: 8,
      status,
      doctorId: DOC,
      appointmentDate: new Date('2030-01-02T10:00:00Z'),
    });
    it('cancels a pending appointment and notifies the doctor', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(appt('PENDING'));
      t.prisma.appointment.update.mockResolvedValue({ id: 8, status: 'CANCELLED' });
      await patch('/patient/appointments/8/cancel').expect(200);
      expect(t.prisma.appointment.update.mock.calls[0][0].data.status).toBe('CANCELLED');
      expect(t.prisma.notification.create.mock.calls[0][0].data.userId).toBe(DOC);
    });
    it('cancels a confirmed appointment', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(appt('CONFIRMED'));
      t.prisma.appointment.update.mockResolvedValue({});
      await patch('/patient/appointments/8/cancel').expect(200);
    });
    it.each(['COMPLETED', 'CANCELLED'])('400 when already %s', async (status) => {
      t.prisma.appointment.findFirst.mockResolvedValue(appt(status));
      await patch('/patient/appointments/8/cancel').expect(400);
      expect(t.prisma.appointment.update).not.toHaveBeenCalled();
    });
    it("404 for someone else's appointment", async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await patch('/patient/appointments/8/cancel').expect(404);
    });
  });

  describe('medical data', () => {
    it('GET /patient/records lists only own records', async () => {
      t.prisma.medicalRecord.findMany.mockResolvedValue([{ id: 1 }]);
      await get('/patient/records').expect(200);
      expect(t.prisma.medicalRecord.findMany.mock.calls[0][0].where).toEqual({ patientId: ME });
    });
    it('GET /patient/records/:id returns an own record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue({ id: 1 });
      await get('/patient/records/1').expect(200);
      expect(t.prisma.medicalRecord.findFirst.mock.calls[0][0].where).toEqual({ id: 1, patientId: ME });
    });
    it("GET /patient/records/:id 404 for someone else's record", async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue(null);
      await get('/patient/records/1').expect(404);
    });
    it('GET /patient/prescriptions is scoped to own records', async () => {
      t.prisma.prescription.findMany.mockResolvedValue([]);
      await get('/patient/prescriptions').expect(200);
      expect(t.prisma.prescription.findMany.mock.calls[0][0].where).toEqual({ record: { patientId: ME } });
    });
    it('GET /patient/test-results is scoped to own records', async () => {
      t.prisma.testResult.findMany.mockResolvedValue([]);
      await get('/patient/test-results').expect(200);
      expect(t.prisma.testResult.findMany.mock.calls[0][0].where).toEqual({ record: { patientId: ME } });
    });
  });

  describe('/patient/feedbacks', () => {
    const body = { doctorId: DOC, rating: 5, comment: 'Great' };
    it('POST creates a review after a completed appointment', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 1 });
      t.prisma.feedback.findFirst.mockResolvedValue(null);
      t.prisma.feedback.create.mockResolvedValue({ id: 1 });
      await post('/patient/feedbacks', body).expect(201);
      expect(t.prisma.feedback.create.mock.calls[0][0].data).toMatchObject({ patientId: ME, doctorId: DOC, rating: 5 });
      expect(t.prisma.appointment.findFirst.mock.calls[0][0].where.status).toBe('COMPLETED');
    });
    it('POST 400 without a completed appointment', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await post('/patient/feedbacks', body).expect(400);
    });
    it('POST 409 on a second review of the same doctor', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue({ staffId: DOC });
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 1 });
      t.prisma.feedback.findFirst.mockResolvedValue({ id: 1 });
      await post('/patient/feedbacks', body).expect(409);
    });
    it('POST 404 for an unknown doctor', async () => {
      t.prisma.doctor.findFirst.mockResolvedValue(null);
      await post('/patient/feedbacks', body).expect(404);
    });
    it.each([0, 6, 2.5])('POST 400 for rating %s', async (rating) => {
      await post('/patient/feedbacks', { ...body, rating }).expect(400);
    });
    it('GET lists only own reviews', async () => {
      t.prisma.feedback.findMany.mockResolvedValue([]);
      await get('/patient/feedbacks').expect(200);
      expect(t.prisma.feedback.findMany.mock.calls[0][0].where).toEqual({ patientId: ME });
    });
  });
});
