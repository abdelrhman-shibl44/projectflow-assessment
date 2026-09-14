import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { OrganizationRole, ProjectRole, TaskPriority, TaskStatus } from '@projectflow/shared';
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

describe('Tasks', () => {
  let app: INestApplication;
  let connection: Connection;

  let owner: TestUser;
  let manager: TestUser;   // PROJECT_MANAGER on the project
  let member: TestUser;    // regular project MEMBER
  let colleague: TestUser; // regular project MEMBER
  let outsider: TestUser;  // no org/project access
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
  });

  it('lets a project member create a task', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({
        title: 'Improve API error handling',
        description: 'Normalise validation and permission errors.',
        priority: TaskPriority.HIGH,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      key: 'ENG-1',
      number: 1,
      title: 'Improve API error handling',
      status: TaskStatus.TODO,
      priority: TaskPriority.HIGH,
    });
    expect(response.body.createdBy).toMatchObject({ email: 'magd@example.com' });
  });

  it('numbers tasks sequentially within a project', async () => {
    for (const title of ['First task', 'Second task', 'Third task']) {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks`)
        .set('Authorization', authHeader(member))
        .send({ title })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(3);
    expect(response.body.items.map((task: { key: string }) => task.key)).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
    ]);
  });

  it('refuses to create a task for someone outside the project', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(outsider))
      .send({ title: 'Should not be created' })
      .expect(403);
  });

  it('refuses to list tasks for someone outside the project', async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });

  it('rejects a task without a usable title', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'ab' })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
  });

  it('filters the task list by status', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Work in flight', status: TaskStatus.IN_PROGRESS })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Not started yet' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .query({ status: TaskStatus.IN_PROGRESS })
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ title: 'Work in flight' });
  });

  describe('task assignment', () => {
    beforeEach(async () => {
      taskId = await createTask(
        connection,
        projectId,
        'ENG',
        1,
        'Assignment target',
        owner.id,
      );
    });

    it('lets a project member assign themselves', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: member.id })
        .expect(200);

      expect(response.body.assignee).toMatchObject({
        id: member.id,
        email: 'magd@example.com',
      });
    });

    it('lets a project member unassign themselves', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: member.id })
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: null })
        .expect(200);

      expect(response.body.assignee).toBeNull();
    });

    it('refuses to let a regular member assign another project member', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: colleague.id })
        .expect(403);
    });

    it('refuses to let a regular member unassign another user', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(manager))
        .send({ assigneeId: colleague.id })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .send({ assigneeId: null })
        .expect(403);
    });

    it('lets an authorized manager assign another project member', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(manager))
        .send({ assigneeId: colleague.id })
        .expect(200);

      expect(response.body.assignee).toMatchObject({ id: colleague.id });
    });

    it('refuses to assign a user outside the project', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(manager))
        .send({ assigneeId: outsider.id })
        .expect(403);
    });

    it('refuses to let a user outside the project modify a task', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(outsider))
        .send({ assigneeId: outsider.id })
        .expect(403);
    });

    it('returns the assignee on the task detail', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(manager))
        .send({ assigneeId: colleague.id })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .expect(200);

      expect(response.body.assignee).toMatchObject({
        id: colleague.id,
        email: 'sarah@example.com',
      });
    });

    it('returns a null assignee for an unassigned task', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .set('Authorization', authHeader(member))
        .expect(200);

      expect(response.body.assignee).toBeNull();
    });

    it('returns the assignee in the task list', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', authHeader(manager))
        .send({ assigneeId: colleague.id })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/projects/${projectId}/tasks`)
        .set('Authorization', authHeader(member))
        .expect(200);

      expect(response.body.items[0].assignee).toMatchObject({
        id: colleague.id,
        email: 'sarah@example.com',
      });
    });
  });
});
