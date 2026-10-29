import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

const ADMIN = 1;

describe('Admin API (/admin)', () => {
  let t: TestApp;
  let auth: string;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => {
    t.reset();
    auth = t.as('ADMIN', ADMIN);
  });

  const get = (path: string) => t.http().get(path).set('Authorization', auth);
  const post = (path: string, body?: object) =>
    t.http().post(path).set('Authorization', auth).send(body);
  const patch = (path: string, body?: object) =>
    t.http().patch(path).set('Authorization', auth).send(body);
  const del = (path: string) => t.http().delete(path).set('Authorization', auth);

  describe('GET /admin/users', () => {
    it('returns a page with a total', async () => {
      t.prisma.user.findMany.mockResolvedValue([{ id: 2 }]);
      t.prisma.user.count.mockResolvedValue(41);
      const res = await get('/admin/users?page=3&limit=10').expect(200);
      expect(res.body).toMatchObject({ total: 41, page: 3, limit: 10 });
      const args = t.prisma.user.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
      expect(args.select.passwordHash).toBeUndefined();
    });
    it('filters by role, status and search', async () => {
      t.prisma.user.findMany.mockResolvedValue([]);
      t.prisma.user.count.mockResolvedValue(0);
      await get('/admin/users?role=DOCTOR&status=ACTIVE&search=ann').expect(200);
      const { where } = t.prisma.user.findMany.mock.calls[0][0];
      expect(where.role).toBe('DOCTOR');
      expect(where.status).toBe('ACTIVE');
      expect(where.OR).toHaveLength(3);
    });
    it('uses default paging', async () => {
      t.prisma.user.findMany.mockResolvedValue([]);
      t.prisma.user.count.mockResolvedValue(0);
      await get('/admin/users').expect(200);
      expect(t.prisma.user.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 });
    });
    it.each(['limit=1000', 'page=0', 'role=KING'])('400 for ?%s', async (qs) => {
      await get(`/admin/users?${qs}`).expect(400);
    });
  });

  describe('GET /admin/users/:id', () => {
    it('returns a user', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 2 });
      await get('/admin/users/2').expect(200);
    });
    it('404 for an unknown user', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      await get('/admin/users/2').expect(404);
    });
  });

  describe('PATCH /admin/users/:id', () => {
    it('updates a user', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.user.update.mockResolvedValue({ id: 2, status: 'BLOCKED' });
      await patch('/admin/users/2', { status: 'BLOCKED' }).expect(200);
      expect(t.prisma.user.update.mock.calls[0][0].data).toEqual({ status: 'BLOCKED' });
      expect(t.prisma.doctor.upsert).not.toHaveBeenCalled();
    });
    it('creates the doctors row when promoting to DOCTOR', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.user.update.mockResolvedValue({ id: 2, role: 'DOCTOR' });
      await patch('/admin/users/2', { role: 'DOCTOR' }).expect(200);
      expect(t.prisma.doctor.upsert.mock.calls[0][0].where).toEqual({ staffId: 2 });
    });
    it('cannot demote or deactivate yourself', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: ADMIN });
      await patch(`/admin/users/${ADMIN}`, { role: 'PATIENT' }).expect(400);
      auth = t.as('ADMIN', ADMIN);
      await patch(`/admin/users/${ADMIN}`, { status: 'BLOCKED' }).expect(400);
      expect(t.prisma.user.update).not.toHaveBeenCalled();
    });
    it('can edit your own non-critical fields', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: ADMIN });
      t.prisma.user.update.mockResolvedValue({ id: ADMIN });
      await patch(`/admin/users/${ADMIN}`, { phone: '555' }).expect(200);
    });
    it('404 for an unknown user', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      await patch('/admin/users/2', { phone: '1' }).expect(404);
    });
    it('400 for an unknown field (passwordHash cannot be set)', async () => {
      await patch('/admin/users/2', { passwordHash: 'x' }).expect(400);
    });
  });

  describe('DELETE /admin/users/:id', () => {
    it('deactivates instead of deleting', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.user.update.mockResolvedValue({ id: 2, status: 'INACTIVE' });
      await del('/admin/users/2').expect(200);
      expect(t.prisma.user.update.mock.calls[0][0].data).toEqual({ status: 'INACTIVE' });
    });
    it('cannot deactivate yourself', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: ADMIN });
      await del(`/admin/users/${ADMIN}`).expect(400);
    });
    it('404 for an unknown user', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      await del('/admin/users/2').expect(404);
    });
  });

  describe('POST /admin/users/:id/password', () => {
    it('stores a bcrypt hash, not the password', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 2 });
      await post('/admin/users/2/password', { password: 'brand-new-pass' }).expect(204);
      const { data } = t.prisma.user.update.mock.calls[0][0];
      expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(data.passwordHash).not.toContain('brand-new-pass');
    });
    it('400 for a short password', async () => {
      await post('/admin/users/2/password', { password: '123' }).expect(400);
    });
    it('404 for an unknown user', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      await post('/admin/users/2/password', { password: 'brand-new-pass' }).expect(404);
    });
  });

  describe('/admin/doctors', () => {
    it('GET lists doctors', async () => {
      t.prisma.doctor.findMany.mockResolvedValue([{ staffId: 5 }]);
      const res = await get('/admin/doctors').expect(200);
      expect(res.body).toHaveLength(1);
    });
    it('PATCH updates a doctor', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: 5 });
      t.prisma.department.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.doctor.update.mockResolvedValue({ staffId: 5 });
      await patch('/admin/doctors/5', { departmentId: 2, specialization: 'ENT' }).expect(200);
      expect(t.prisma.doctor.update.mock.calls[0][0].where).toEqual({ staffId: 5 });
    });
    it('PATCH 404 for an unknown department', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: 5 });
      t.prisma.department.findUnique.mockResolvedValue(null);
      await patch('/admin/doctors/5', { departmentId: 99 }).expect(404);
    });
    it('PATCH 404 for an unknown doctor', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue(null);
      await patch('/admin/doctors/5', { specialization: 'x' }).expect(404);
    });
  });

  describe('/admin/doctors/:id/schedule', () => {
    it('GET lists the schedule of any doctor', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: 5 });
      t.prisma.schedule.findMany.mockResolvedValue([{ id: 1 }]);
      await get('/admin/doctors/5/schedule').expect(200);
      expect(t.prisma.schedule.findMany.mock.calls[0][0].where).toEqual({ doctorId: 5 });
    });
    it('POST creates a slot for that doctor', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: 5 });
      t.prisma.schedule.create.mockResolvedValue({ id: 1 });
      await post('/admin/doctors/5/schedule', {
        workDate: '2030-01-02',
        startTime: '08:00',
        endTime: '12:00',
      }).expect(201);
      expect(t.prisma.schedule.create.mock.calls[0][0].data.doctorId).toBe(5);
    });
    it('POST 404 for an unknown doctor', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue(null);
      await post('/admin/doctors/5/schedule', {
        workDate: '2030-01-02',
        startTime: '08:00',
        endTime: '12:00',
      }).expect(404);
    });
    it('DELETE removes a slot', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: 5 });
      t.prisma.schedule.deleteMany.mockResolvedValue({ count: 1 });
      await del('/admin/doctors/5/schedule/9').expect(204);
      expect(t.prisma.schedule.deleteMany.mock.calls[0][0].where).toEqual({ id: 9, doctorId: 5 });
    });
    it('DELETE 404 for an unknown slot', async () => {
      t.prisma.doctor.findUnique.mockResolvedValue({ staffId: 5 });
      t.prisma.schedule.deleteMany.mockResolvedValue({ count: 0 });
      await del('/admin/doctors/5/schedule/9').expect(404);
    });
  });

  describe('/admin/appointments', () => {
    it('GET lists a page with filters', async () => {
      t.prisma.appointment.findMany.mockResolvedValue([{ id: 1 }]);
      t.prisma.appointment.count.mockResolvedValue(1);
      const res = await get('/admin/appointments?status=PENDING&doctorId=5&patientId=3').expect(200);
      expect(res.body.total).toBe(1);
      const { where } = t.prisma.appointment.findMany.mock.calls[0][0];
      expect(where).toMatchObject({ status: 'PENDING', doctorId: 5, patientId: 3 });
    });
    it('GET :id returns one', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue({ id: 1 });
      await get('/admin/appointments/1').expect(200);
    });
    it('GET :id 404', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(null);
      await get('/admin/appointments/1').expect(404);
    });
    it('PATCH :id changes status and notes', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.appointment.update.mockResolvedValue({ id: 1 });
      await patch('/admin/appointments/1', { status: 'CANCELLED', notes: 'n/a' }).expect(200);
      expect(t.prisma.appointment.update.mock.calls[0][0].data).toEqual({
        status: 'CANCELLED',
        notes: 'n/a',
      });
    });
    it('PATCH :id 400 for an invalid status', async () => {
      await patch('/admin/appointments/1', { status: 'X' }).expect(400);
    });
    it('PATCH :id 404', async () => {
      t.prisma.appointment.findUnique.mockResolvedValue(null);
      await patch('/admin/appointments/1', { notes: 'x' }).expect(404);
    });
  });

  describe('/admin/feedbacks', () => {
    it('GET lists a page, optionally by doctor', async () => {
      t.prisma.feedback.findMany.mockResolvedValue([]);
      t.prisma.feedback.count.mockResolvedValue(0);
      await get('/admin/feedbacks?doctorId=5').expect(200);
      expect(t.prisma.feedback.findMany.mock.calls[0][0].where).toEqual({ doctorId: 5 });
    });
    it('DELETE removes a review', async () => {
      t.prisma.feedback.deleteMany.mockResolvedValue({ count: 1 });
      await del('/admin/feedbacks/4').expect(204);
    });
    it('DELETE 404 for an unknown review', async () => {
      t.prisma.feedback.deleteMany.mockResolvedValue({ count: 0 });
      await del('/admin/feedbacks/4').expect(404);
    });
  });

  describe('POST /admin/notifications', () => {
    it('sends a notification to a user', async () => {
      t.prisma.user.findUnique.mockResolvedValue({ id: 2 });
      t.prisma.notification.create.mockResolvedValue({ id: 1 });
      await post('/admin/notifications', { userId: 2, title: 'Hello' }).expect(201);
      expect(t.prisma.notification.create.mock.calls[0][0].data).toMatchObject({ userId: 2, title: 'Hello' });
    });
    it('404 for an unknown user', async () => {
      t.prisma.user.findUnique.mockResolvedValue(null);
      await post('/admin/notifications', { userId: 2, title: 'Hello' }).expect(404);
    });
    it('400 without a title', async () => {
      await post('/admin/notifications', { userId: 2 }).expect(400);
    });
  });
});
