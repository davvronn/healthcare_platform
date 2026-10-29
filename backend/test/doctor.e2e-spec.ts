import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

const DOC = 7;

describe('Doctor API (/doctor)', () => {
  let t: TestApp;
  let auth: string;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => {
    t.reset();
    auth = t.as('DOCTOR', DOC);
  });

  const get = (path: string) => t.http().get(path).set('Authorization', auth);
  const post = (path: string, body?: object) =>
    t.http().post(path).set('Authorization', auth).send(body);
  const patch = (path: string, body?: object) =>
    t.http().patch(path).set('Authorization', auth).send(body);
  const del = (path: string) => t.http().delete(path).set('Authorization', auth);

  describe('GET /doctor/profile', () => {
    it('returns the doctor profile scoped to the token user', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: DOC });
      await get('/doctor/profile').expect(200);
      expect(t.prisma.doctor.findUnique.mock.calls[0][0].where).toEqual({ staffId: DOC });
    });
    it('404 when there is no doctors row', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue(null);
      await get('/doctor/profile').expect(404);
    });
  });

  describe('GET /doctor/appointments', () => {
    it('lists only own appointments', async () => {
      t.prisma.appointment.findMany.mockResolvedValue([{ id: 1 }]);
      const res = await get('/doctor/appointments').expect(200);
      expect(res.body).toHaveLength(1);
      expect(t.prisma.appointment.findMany.mock.calls[0][0].where.doctorId).toBe(DOC);
    });
    it('applies the status filter', async () => {
      t.prisma.appointment.findMany.mockResolvedValue([]);
      await get('/doctor/appointments?status=CONFIRMED').expect(200);
      expect(t.prisma.appointment.findMany.mock.calls[0][0].where.status).toBe('CONFIRMED');
    });
    it('400 on an invalid status', async () => {
      await get('/doctor/appointments?status=WHATEVER').expect(400);
    });
  });

  describe('GET /doctor/appointments/:id', () => {
    it('returns an own appointment (query is scoped by doctorId)', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 3 });
      await get('/doctor/appointments/3').expect(200);
      expect(t.prisma.appointment.findFirst.mock.calls[0][0].where).toEqual({
        id: 3,
        doctorId: DOC,
      });
    });
    it("404 for someone else's appointment", async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await get('/doctor/appointments/3').expect(404);
    });
    it('400 for a non-numeric id', async () => {
      await get('/doctor/appointments/abc').expect(400);
    });
  });

  describe('PATCH /doctor/appointments/:id/status', () => {
    const appt = (status: string) => ({
      id: 3,
      status,
      patientId: 11,
      appointmentDate: new Date('2030-01-01T10:00:00Z'),
      notes: null,
    });

    it('confirms a pending appointment and notifies the patient', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(appt('PENDING'));
      t.prisma.appointment.update.mockResolvedValue({ id: 3, status: 'CONFIRMED' });
      await patch('/doctor/appointments/3/status', { status: 'CONFIRMED' }).expect(200);
      expect(t.prisma.appointment.update.mock.calls[0][0].data.status).toBe('CONFIRMED');
      expect(t.prisma.notification.create.mock.calls[0][0].data.userId).toBe(11);
    });
    it('rejects an illegal transition (COMPLETED -> CONFIRMED)', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(appt('COMPLETED'));
      await patch('/doctor/appointments/3/status', { status: 'CONFIRMED' }).expect(400);
      expect(t.prisma.appointment.update).not.toHaveBeenCalled();
    });
    it('rejects PENDING -> COMPLETED', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(appt('PENDING'));
      await patch('/doctor/appointments/3/status', { status: 'COMPLETED' }).expect(400);
    });
    it('404 for a foreign appointment', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await patch('/doctor/appointments/3/status', { status: 'CONFIRMED' }).expect(404);
    });
    it('400 for an invalid status value', async () => {
      await patch('/doctor/appointments/3/status', { status: 'NOPE' }).expect(400);
    });
  });

  describe('GET /doctor/patients', () => {
    it('lists patients that have appointments with this doctor', async () => {
      t.prisma.user.findMany.mockResolvedValue([{ id: 11 }]);
      await get('/doctor/patients').expect(200);
      expect(t.prisma.user.findMany.mock.calls[0][0].where).toEqual({
        appointments: { some: { doctorId: DOC } },
      });
    });
  });

  describe('GET /doctor/patients/:id/records', () => {
    it('returns the history for an own patient', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 1 });
      t.prisma.medicalRecord.findMany.mockResolvedValue([{ id: 5 }]);
      const res = await get('/doctor/patients/11/records').expect(200);
      expect(res.body).toHaveLength(1);
      expect(t.prisma.appointment.findFirst.mock.calls[0][0].where).toEqual({
        doctorId: DOC,
        patientId: 11,
      });
    });
    it('403 for a patient the doctor never treated', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await get('/doctor/patients/11/records').expect(403);
      expect(t.prisma.medicalRecord.findMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /doctor/records', () => {
    const body = {
      appointmentId: 3,
      diagnosisId: 2,
      treatment: 'Rest',
      prescriptions: [{ medicationName: 'Aspirin', dosage: '100mg' }],
    };
    it('creates a record for an own appointment, taking patientId from it', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue({
        id: 3,
        patientId: 11,
        medicalRecord: null,
      });
      t.prisma.diagnosis.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.medicalRecord.create.mockResolvedValue({ id: 5 });
      await post('/doctor/records', body).expect(201);
      const { data } = t.prisma.medicalRecord.create.mock.calls[0][0];
      expect(data.patientId).toBe(11);
      expect(data.appointmentId).toBe(3);
      expect(data.prescriptions.create).toHaveLength(1);
    });
    it('409 when the appointment already has a record', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 3, medicalRecord: { id: 1 } });
      await post('/doctor/records', body).expect(409);
    });
    it('404 for an unknown diagnosis', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue({ id: 3, medicalRecord: null });
      t.prisma.diagnosis.findUnique.mockResolvedValue(null);
      await post('/doctor/records', body).expect(404);
    });
    it('404 for a foreign appointment', async () => {
      t.prisma.appointment.findFirst.mockResolvedValue(null);
      await post('/doctor/records', body).expect(404);
    });
    it('400 without appointmentId', async () => {
      await post('/doctor/records', { treatment: 'x' }).expect(400);
    });
    it('400 for an invalid nested prescription', async () => {
      await post('/doctor/records', { appointmentId: 3, prescriptions: [{ dosage: '1' }] }).expect(400);
    });
  });

  describe('GET /doctor/records and /doctor/records/:id', () => {
    it('lists own records (scoped through the appointment)', async () => {
      t.prisma.medicalRecord.findMany.mockResolvedValue([]);
      await get('/doctor/records').expect(200);
      expect(t.prisma.medicalRecord.findMany.mock.calls[0][0].where).toEqual({
        appointment: { doctorId: DOC },
      });
    });
    it('returns one own record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue({ id: 5 });
      await get('/doctor/records/5').expect(200);
      expect(t.prisma.medicalRecord.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        appointment: { doctorId: DOC },
      });
    });
    it('404 for a foreign record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue(null);
      await get('/doctor/records/5').expect(404);
    });
  });

  describe('PATCH /doctor/records/:id', () => {
    it('updates an own record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue({ id: 5 });
      t.prisma.medicalRecord.update.mockResolvedValue({ id: 5, treatment: 'New' });
      await patch('/doctor/records/5', { treatment: 'New' }).expect(200);
      expect(t.prisma.medicalRecord.update.mock.calls[0][0].data).toEqual({ treatment: 'New' });
    });
    it('404 for an unknown diagnosis', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue({ id: 5 });
      t.prisma.diagnosis.findUnique.mockResolvedValue(null);
      await patch('/doctor/records/5', { diagnosisId: 99 }).expect(404);
    });
    it('404 for a foreign record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue(null);
      await patch('/doctor/records/5', { treatment: 'x' }).expect(404);
    });
    it('400 on an unknown field', async () => {
      await patch('/doctor/records/5', { patientId: 1 }).expect(400);
    });
  });

  describe('POST /doctor/records/:id/prescriptions', () => {
    it('adds a prescription to an own record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue({ id: 5 });
      t.prisma.prescription.create.mockResolvedValue({ id: 1 });
      await post('/doctor/records/5/prescriptions', { medicationName: 'Ibuprofen' }).expect(201);
      expect(t.prisma.prescription.create.mock.calls[0][0].data.recordId).toBe(5);
    });
    it('404 for a foreign record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue(null);
      await post('/doctor/records/5/prescriptions', { medicationName: 'x' }).expect(404);
    });
    it('400 without medicationName', async () => {
      await post('/doctor/records/5/prescriptions', {}).expect(400);
    });
  });

  describe('PATCH/DELETE /doctor/prescriptions/:id', () => {
    it('updates an own prescription', async () => {
      t.prisma.prescription.findFirst.mockResolvedValue({ id: 1 });
      t.prisma.prescription.update.mockResolvedValue({ id: 1 });
      await patch('/doctor/prescriptions/1', { dosage: '2x' }).expect(200);
      expect(t.prisma.prescription.findFirst.mock.calls[0][0].where).toEqual({
        id: 1,
        record: { appointment: { doctorId: DOC } },
      });
    });
    it('404 when updating a foreign prescription', async () => {
      t.prisma.prescription.findFirst.mockResolvedValue(null);
      await patch('/doctor/prescriptions/1', { dosage: '2x' }).expect(404);
    });
    it('deletes an own prescription', async () => {
      t.prisma.prescription.findFirst.mockResolvedValue({ id: 1 });
      await del('/doctor/prescriptions/1').expect(204);
      expect(t.prisma.prescription.delete).toHaveBeenCalledOnce();
    });
    it('404 when deleting a foreign prescription', async () => {
      t.prisma.prescription.findFirst.mockResolvedValue(null);
      await del('/doctor/prescriptions/1').expect(404);
      expect(t.prisma.prescription.delete).not.toHaveBeenCalled();
    });
  });

  describe('POST /doctor/records/:id/test-results', () => {
    const body = { testName: 'Blood', testDate: '2030-01-01T09:00:00Z' };
    it('adds a test result to an own record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue({ id: 5 });
      t.prisma.testResult.create.mockResolvedValue({ id: 1 });
      await post('/doctor/records/5/test-results', body).expect(201);
      expect(t.prisma.testResult.create.mock.calls[0][0].data.recordId).toBe(5);
    });
    it('404 for a foreign record', async () => {
      t.prisma.medicalRecord.findFirst.mockResolvedValue(null);
      await post('/doctor/records/5/test-results', body).expect(404);
    });
    it('400 for an invalid date', async () => {
      await post('/doctor/records/5/test-results', { testName: 'x', testDate: 'soon' }).expect(400);
    });
  });

  describe('PATCH/DELETE /doctor/test-results/:id', () => {
    it('updates an own test result', async () => {
      t.prisma.testResult.findFirst.mockResolvedValue({ id: 1 });
      t.prisma.testResult.update.mockResolvedValue({ id: 1 });
      await patch('/doctor/test-results/1', { status: 'COMPLETED' }).expect(200);
    });
    it('400 for an invalid status', async () => {
      await patch('/doctor/test-results/1', { status: 'DONE' }).expect(400);
    });
    it('404 when updating a foreign test result', async () => {
      t.prisma.testResult.findFirst.mockResolvedValue(null);
      await patch('/doctor/test-results/1', { status: 'COMPLETED' }).expect(404);
    });
    it('deletes an own test result', async () => {
      t.prisma.testResult.findFirst.mockResolvedValue({ id: 1 });
      await del('/doctor/test-results/1').expect(204);
      expect(t.prisma.testResult.delete).toHaveBeenCalledOnce();
    });
    it('404 when deleting a foreign test result', async () => {
      t.prisma.testResult.findFirst.mockResolvedValue(null);
      await del('/doctor/test-results/1').expect(404);
    });
  });

  describe('/doctor/schedule', () => {
    it('GET lists own schedule', async () => {
      t.prisma.schedule.findMany.mockResolvedValue([{ id: 1 }]);
      await get('/doctor/schedule').expect(200);
      expect(t.prisma.schedule.findMany.mock.calls[0][0].where).toEqual({ doctorId: DOC });
    });
    it('POST creates a slot with HH:mm converted to a time', async () => {
      t.prisma.schedule.create.mockResolvedValue({ id: 1 });
      await post('/doctor/schedule', {
        workDate: '2030-01-02',
        startTime: '09:00',
        endTime: '17:30',
      }).expect(201);
      const { data } = t.prisma.schedule.create.mock.calls[0][0];
      expect(data.doctorId).toBe(DOC);
      expect(data.startTime.toISOString()).toBe('1970-01-01T09:00:00.000Z');
      expect(data.endTime.toISOString()).toBe('1970-01-01T17:30:00.000Z');
    });
    it('POST 400 when start is not before end', async () => {
      await post('/doctor/schedule', {
        workDate: '2030-01-02',
        startTime: '17:00',
        endTime: '09:00',
      }).expect(400);
    });
    it.each(['9:00', '25:00', 'noon'])('POST 400 for bad time %s', async (startTime) => {
      await post('/doctor/schedule', { workDate: '2030-01-02', startTime, endTime: '18:00' }).expect(400);
    });
    it('DELETE removes an own slot', async () => {
      t.prisma.schedule.deleteMany.mockResolvedValue({ count: 1 });
      await del('/doctor/schedule/4').expect(204);
      expect(t.prisma.schedule.deleteMany.mock.calls[0][0].where).toEqual({ id: 4, doctorId: DOC });
    });
    it('DELETE 404 for a foreign slot', async () => {
      t.prisma.schedule.deleteMany.mockResolvedValue({ count: 0 });
      await del('/doctor/schedule/4').expect(404);
    });
  });

  describe('GET /doctor/feedbacks', () => {
    it('returns items with the average rating', async () => {
      t.prisma.feedback.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      t.prisma.feedback.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 });
      const res = await get('/doctor/feedbacks').expect(200);
      expect(res.body).toMatchObject({ averageRating: 4.5, total: 2 });
      expect(res.body.items).toHaveLength(2);
      expect(t.prisma.feedback.findMany.mock.calls[0][0].where).toEqual({ doctorId: DOC });
    });
  });
});
