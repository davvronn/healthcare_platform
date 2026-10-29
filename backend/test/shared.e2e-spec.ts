import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('Shared resources', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  describe('/departments', () => {
    it('GET lists departments for any authenticated user', async () => {
      t.prisma.department.findMany.mockResolvedValue([{ id: 1 }]);
      const res = await t.http().get('/departments').set('Authorization', t.as('PATIENT')).expect(200);
      expect(res.body).toHaveLength(1);
    });
    it('GET :id returns a department', async () => {
      t.prisma.department.findUnique.mockResolvedValue({ id: 1 });
      await t.http().get('/departments/1').set('Authorization', t.as('NURSE')).expect(200);
    });
    it('GET :id 404', async () => {
      const auth = t.as('NURSE');
      t.prisma.department.findUnique.mockResolvedValue(null);
      await t.http().get('/departments/1').set('Authorization', auth).expect(404);
    });
    it('POST creates (ADMIN)', async () => {
      const auth = t.as('ADMIN');
      t.prisma.department.create.mockResolvedValue({ id: 1 });
      await t
        .http()
        .post('/departments')
        .set('Authorization', auth)
        .send({ departmentName: 'Cardiology', location: 'Floor 2' })
        .expect(201);
    });
    it('POST 400 without a name', async () => {
      await t.http().post('/departments').set('Authorization', t.as('ADMIN')).send({}).expect(400);
    });
    it('POST 403 for a doctor', async () => {
      await t
        .http()
        .post('/departments')
        .set('Authorization', t.as('DOCTOR'))
        .send({ departmentName: 'x' })
        .expect(403);
    });
    it('PATCH updates (ADMIN)', async () => {
      const auth = t.as('ADMIN');
      t.prisma.department.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.department.update.mockResolvedValue({ id: 1 });
      await t
        .http()
        .patch('/departments/1')
        .set('Authorization', auth)
        .send({ location: 'Floor 3' })
        .expect(200);
    });
    it('PATCH 404', async () => {
      const auth = t.as('ADMIN');
      t.prisma.department.findUnique.mockResolvedValue(null);
      await t.http().patch('/departments/1').set('Authorization', auth).send({ location: 'x' }).expect(404);
    });
    it('DELETE removes an empty department', async () => {
      const auth = t.as('ADMIN');
      t.prisma.department.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.doctor.count.mockResolvedValue(0);
      await t.http().delete('/departments/1').set('Authorization', auth).expect(204);
      expect(t.prisma.department.delete).toHaveBeenCalledOnce();
    });
    it('DELETE 409 while doctors are assigned', async () => {
      const auth = t.as('ADMIN');
      t.prisma.department.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.doctor.count.mockResolvedValue(2);
      await t.http().delete('/departments/1').set('Authorization', auth).expect(409);
      expect(t.prisma.department.delete).not.toHaveBeenCalled();
    });
    it('DELETE 404', async () => {
      const auth = t.as('ADMIN');
      t.prisma.department.findUnique.mockResolvedValue(null);
      await t.http().delete('/departments/1').set('Authorization', auth).expect(404);
    });
  });

  describe('/diagnoses', () => {
    it('GET lists a page for a doctor', async () => {
      const auth = t.as('DOCTOR');
      t.prisma.diagnosis.findMany.mockResolvedValue([{ id: 1 }]);
      t.prisma.diagnosis.count.mockResolvedValue(1);
      const res = await t.http().get('/diagnoses?search=flu').set('Authorization', auth).expect(200);
      expect(res.body).toMatchObject({ total: 1, page: 1 });
      expect(t.prisma.diagnosis.findMany.mock.calls[0][0].where.name.contains).toBe('flu');
    });
    it('GET :id returns a diagnosis', async () => {
      const auth = t.as('NURSE');
      t.prisma.diagnosis.findUnique.mockResolvedValue({ id: 1 });
      await t.http().get('/diagnoses/1').set('Authorization', auth).expect(200);
    });
    it('GET :id 404', async () => {
      const auth = t.as('DOCTOR');
      t.prisma.diagnosis.findUnique.mockResolvedValue(null);
      await t.http().get('/diagnoses/1').set('Authorization', auth).expect(404);
    });
    it('is hidden from patients', async () => {
      await t.http().get('/diagnoses').set('Authorization', t.as('PATIENT')).expect(403);
    });
    it('POST: a doctor may add an entry', async () => {
      const auth = t.as('DOCTOR');
      t.prisma.diagnosis.create.mockResolvedValue({ id: 1 });
      await t.http().post('/diagnoses').set('Authorization', auth).send({ name: 'Flu' }).expect(201);
    });
    it('POST: a nurse may not', async () => {
      await t
        .http()
        .post('/diagnoses')
        .set('Authorization', t.as('NURSE'))
        .send({ name: 'Flu' })
        .expect(403);
    });
    it('POST 400 without a name', async () => {
      await t.http().post('/diagnoses').set('Authorization', t.as('ADMIN')).send({}).expect(400);
    });
    it('PATCH: ADMIN edits', async () => {
      const auth = t.as('ADMIN');
      t.prisma.diagnosis.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.diagnosis.update.mockResolvedValue({ id: 1 });
      await t.http().patch('/diagnoses/1').set('Authorization', auth).send({ name: 'Cold' }).expect(200);
    });
    it('PATCH: a doctor may not', async () => {
      await t
        .http()
        .patch('/diagnoses/1')
        .set('Authorization', t.as('DOCTOR'))
        .send({ name: 'Cold' })
        .expect(403);
    });
    it('DELETE removes an unused diagnosis', async () => {
      const auth = t.as('ADMIN');
      t.prisma.diagnosis.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.medicalRecord.count.mockResolvedValue(0);
      await t.http().delete('/diagnoses/1').set('Authorization', auth).expect(204);
    });
    it('DELETE 409 when used in records', async () => {
      const auth = t.as('ADMIN');
      t.prisma.diagnosis.findUnique.mockResolvedValue({ id: 1 });
      t.prisma.medicalRecord.count.mockResolvedValue(3);
      await t.http().delete('/diagnoses/1').set('Authorization', auth).expect(409);
      expect(t.prisma.diagnosis.delete).not.toHaveBeenCalled();
    });
    it('DELETE: a doctor may not', async () => {
      await t.http().delete('/diagnoses/1').set('Authorization', t.as('DOCTOR')).expect(403);
    });
  });

  describe('/notifications', () => {
    it('GET lists only my notifications', async () => {
      const auth = t.as('PATIENT', 3);
      t.prisma.notification.findMany.mockResolvedValue([{ id: 1 }]);
      const res = await t.http().get('/notifications').set('Authorization', auth).expect(200);
      expect(res.body).toHaveLength(1);
      expect(t.prisma.notification.findMany.mock.calls[0][0].where).toEqual({ userId: 3 });
    });
    it('GET ?unread=true filters unread', async () => {
      const auth = t.as('DOCTOR', 5);
      t.prisma.notification.findMany.mockResolvedValue([]);
      await t.http().get('/notifications?unread=true').set('Authorization', auth).expect(200);
      expect(t.prisma.notification.findMany.mock.calls[0][0].where).toEqual({
        userId: 5,
        isRead: false,
      });
    });
    it('PATCH :id/read marks my notification as read', async () => {
      const auth = t.as('PATIENT', 3);
      t.prisma.notification.updateMany.mockResolvedValue({ count: 1 });
      const res = await t.http().patch('/notifications/7/read').set('Authorization', auth).expect(200);
      expect(res.body).toEqual({ id: 7, isRead: true });
      expect(t.prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ id: 7, userId: 3 });
    });
    it("PATCH :id/read 404 for someone else's notification", async () => {
      const auth = t.as('PATIENT', 3);
      t.prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      await t.http().patch('/notifications/7/read').set('Authorization', auth).expect(404);
    });
    it('PATCH read-all marks all of mine', async () => {
      const auth = t.as('NURSE', 9);
      t.prisma.notification.updateMany.mockResolvedValue({ count: 4 });
      const res = await t.http().patch('/notifications/read-all').set('Authorization', auth).expect(200);
      expect(res.body).toEqual({ updated: 4 });
      expect(t.prisma.notification.updateMany.mock.calls[0][0].where).toEqual({
        userId: 9,
        isRead: false,
      });
    });
  });
});
