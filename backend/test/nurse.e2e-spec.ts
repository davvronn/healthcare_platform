import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('Nurse API (/nurse)', () => {
  let t: TestApp;
  let auth: string;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => {
    t.reset();
    auth = t.as('NURSE', 9);
  });

  const get = (path: string) => t.http().get(path).set('Authorization', auth);
  const patch = (path: string, body?: object) =>
    t.http().patch(path).set('Authorization', auth).send(body);

  describe('GET /nurse/appointments', () => {
    it('lists a page of appointments with filters', async () => {
      t.prisma.appointment.findMany.mockResolvedValue([{ id: 1 }]);
      t.prisma.appointment.count.mockResolvedValue(1);
      const res = await get('/nurse/appointments?status=PENDING&doctorId=5').expect(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, limit: 50 });
      expect(t.prisma.appointment.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'PENDING',
        doctorId: 5,
      });
    });
    it('400 for an invalid status', async () => {
      await get('/nurse/appointments?status=x').expect(400);
    });
  });

  describe('PATCH /nurse/appointments/:id/status', () => {
    const appt = (status: string) => ({
      id: 4,
      status,
      patientId: 3,
      appointmentDate: new Date('2030-01-02T10:00:00Z'),
    });
    it('confirms a pending appointment and notifies the patient', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(appt('PENDING'));
      t.prisma.appointment.update.mockResolvedValue({ id: 4 });
      await patch('/nurse/appointments/4/status', { status: 'CONFIRMED' }).expect(200);
      expect(t.prisma.notification.create.mock.calls[0][0].data.userId).toBe(3);
    });
    it('cancels a pending appointment', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(appt('PENDING'));
      t.prisma.appointment.update.mockResolvedValue({ id: 4 });
      await patch('/nurse/appointments/4/status', { status: 'CANCELLED' }).expect(200);
    });
    it('cannot complete an appointment (doctor-only)', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(appt('PENDING'));
      await patch('/nurse/appointments/4/status', { status: 'COMPLETED' }).expect(400);
    });
    it('cannot touch a non-pending appointment', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(appt('CONFIRMED'));
      await patch('/nurse/appointments/4/status', { status: 'CANCELLED' }).expect(400);
      expect(t.prisma.appointment.update).not.toHaveBeenCalled();
    });
    it('404 for an unknown appointment', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(null);
      await patch('/nurse/appointments/4/status', { status: 'CONFIRMED' }).expect(404);
    });
    it('400 for an invalid status', async () => {
      await patch('/nurse/appointments/4/status', { status: 'x' }).expect(400);
    });
  });

  describe('GET /nurse/patients', () => {
    it('lists only users with the PATIENT role', async () => {
      t.prisma.user.findMany.mockResolvedValue([{ id: 3 }]);
      t.prisma.user.count.mockResolvedValue(1);
      await get('/nurse/patients').expect(200);
      expect(t.prisma.user.findMany.mock.calls[0][0].where.role).toBe('PATIENT');
    });
    it('searches by name or phone', async () => {
      t.prisma.user.findMany.mockResolvedValue([]);
      t.prisma.user.count.mockResolvedValue(0);
      await get('/nurse/patients?search=lee').expect(200);
      expect(t.prisma.user.findMany.mock.calls[0][0].where.OR).toHaveLength(3);
    });
    it('does not expose email or password hash', async () => {
      t.prisma.user.findMany.mockResolvedValue([]);
      t.prisma.user.count.mockResolvedValue(0);
      await get('/nurse/patients').expect(200);
      const { select } = t.prisma.user.findMany.mock.calls[0][0];
      expect(select.email).toBeUndefined();
      expect(select.passwordHash).toBeUndefined();
    });
  });

  describe('GET /nurse/test-results', () => {
    it('lists test results, filtered by status', async () => {
      t.prisma.testResult.findMany.mockResolvedValue([{ id: 1 }]);
      t.prisma.testResult.count.mockResolvedValue(1);
      const res = await get('/nurse/test-results?status=PENDING').expect(200);
      expect(res.body.total).toBe(1);
      expect(t.prisma.testResult.findMany.mock.calls[0][0].where).toEqual({ status: 'PENDING' });
    });
    it('400 for an invalid status', async () => {
      await get('/nurse/test-results?status=x').expect(400);
    });
  });

  describe('PATCH /nurse/test-results/:id', () => {
    it('updates result details and status', async () => {
      t.prisma.testResult.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.testResult.update.mockResolvedValue({ id: 2 });
      await patch('/nurse/test-results/2', { resultDetails: 'Normal', status: 'COMPLETED' }).expect(200);
      expect(t.prisma.testResult.update.mock.calls[0][0].data).toEqual({
        resultDetails: 'Normal',
        status: 'COMPLETED',
      });
    });
    it('cannot rename the test or move it to another record', async () => {
      await patch('/nurse/test-results/2', { testName: 'x' }).expect(400);
    });
    it('404 for an unknown result', async () => {
      t.prisma.testResult.findUnique.mockResolvedValue(null);
      await patch('/nurse/test-results/2', { status: 'COMPLETED' }).expect(404);
    });
  });
});
