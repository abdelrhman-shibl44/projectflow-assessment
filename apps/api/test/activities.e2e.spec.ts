import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { OrganizationRole, ProjectRole } from '@projectflow/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import {
  addOrganizationMember,
  addProjectMember,
  authHeader,
  createOrganization,
  createProject,
  createTask,
  registerUser,
  type TestUser,
} from './utils/fixtures';

describe('Task activities', () => {
  let app: INestApplication;
  let connection: Connection;

  let owner: TestUser;
  let manager: TestUser; // PROJECT_MANAGER on the project
  let member: TestUser; // regular project MEMBER
  let colleague: TestUser; // regular project MEMBER
  let outsider: TestUser; // no org/project access
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    ({ app, connection } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection);

    owner = await registerUser(app, 'Ammar Yaser', 'ammar@example.com');
    manager = await registerUser(app, 'Ahmed Hassan', 'ahmed@example.com');
    member = await registerUser(app, 'Magd Ali', 'magd@example.com');
    colleague = await registerUser(app, 'Sarah Ahmed', 'sarah@example.com');
    outsider = await registerUser(app, 'Outside User', 'outside@example.com');

    const organizationId = await createOrganization(
      connection,
      'Acme Software',
      'acme-software',
      owner.id,
    );
    await addOrganizationMember(connection, organizationId, owner.id, OrganizationRole.OWNER);
    await addOrganizationMember(connection, organizationId, manager.id, OrganizationRole.MEMBER);
    await addOrganizationMember(connection, organizationId, member.id, OrganizationRole.MEMBER);
    await addOrganizationMember(connection, organizationId, colleague.id, OrganizationRole.MEMBER);

    projectId = await createProject(
      connection,
      organizationId,
      'Internal Platform',
      'ENG',
      owner.id,
    );
    await addProjectMember(connection, projectId, manager.id, ProjectRole.PROJECT_MANAGER);
    await addProjectMember(connection, projectId, member.id, ProjectRole.MEMBER);
    await addProjectMember(connection, projectId, colleague.id, ProjectRole.MEMBER);

    taskId = await createTask(connection, projectId, 'ENG', 1, 'Activity target', owner.id);
  });

  it('returns no activity for a task with no assignee changes', async () => {
    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({ total: 0, items: [] });
  });

  it('creates an activity record when an assignee is set', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      type: 'TASK_ASSIGNEE_CHANGED',
      actor: { id: manager.id, email: 'ahmed@example.com' },
      previousAssignee: null,
      newAssignee: { id: colleague.id, email: 'sarah@example.com' },
    });
  });

  it('does not create activity when the assignee is unchanged', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(1);
  });

  it('records reassignment as a separate entry', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: member.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items[0].newAssignee).toMatchObject({ id: member.id });
    expect(response.body.items[0].previousAssignee).toMatchObject({ id: colleague.id });
  });

  it('records unassignment as an activity entry', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: null })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items[0]).toMatchObject({
      previousAssignee: { id: colleague.id },
      newAssignee: null,
    });
  });

  it('returns activity newest first', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: member.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.items[0].newAssignee).toMatchObject({ id: member.id });
    expect(response.body.items[1].newAssignee).toMatchObject({ id: colleague.id });
  });

  it('paginates activity', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: colleague.id })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', authHeader(manager))
      .send({ assigneeId: member.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .query({ page: 1, pageSize: 1 })
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].newAssignee).toMatchObject({ id: member.id });
  });

  it('refuses to list activity for someone outside the project', async () => {
    await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });
});
