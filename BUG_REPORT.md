# Production Bug Report

## Status

Bug existed in the original starter code and is already fixed.

The vulnerability was present in the codebase as delivered and was fixed in commit `02f306b`. The fix was already committed before this assessment's task-assignment/activity-history work began; it was not introduced by this assessment.

## Root Cause

`PATCH /tasks/:taskId/status` originally:

- did not receive the authenticated user ID (`@CurrentUser('id')` was missing from the handler signature)
- did not call `ProjectAccessService` at all
- directly loaded the task via `findTaskOrFail(taskId)` and saved the new status

Because the endpoint had no authorization check and no notion of who was calling it, any authenticated user could change the status of any task they could guess the ID of.

## Impact

Any authenticated user — including an outsider with no project membership and no organization access — could change the status of arbitrary tasks. Task state could be corrupted by completely unrelated accounts, and the data shown to project members no longer reflected legitimate workflow changes. This is an authorization bypass on a state-mutating endpoint.

## Reproduction

This reproduces the **original vulnerable implementation**, not the current fixed code:

1. The attacker registers an account and authenticates (obtains a JWT).
2. A legitimate project exists containing a task with id `{taskId}`.
3. The attacker has no membership in that project's organization or project.
4. The attacker calls:

```
PATCH /tasks/{taskId}/status
Authorization: Bearer <attacker-jwt>
Content-Type: application/json

{ "status": "DONE" }
```

5. The original implementation returned `200` and the task's status was changed, even though the attacker had no authorized access to the project.

The current implementation rejects this request with `403 Forbidden`.

## Fix

Commit `02f306b` (`fix: enforce task mutation authorization`) fixed the vulnerability. Specifically:

- `apps/api/src/tasks/tasks.controller.ts`: the `updateStatus` handler now extracts `@CurrentUser('id')` and passes the `userId` to the service instead of calling `updateStatus(taskId, dto)` without a user.
- `apps/api/src/tasks/tasks.service.ts`:
  - `updateStatus` now accepts `userId` and first calls `projectAccessService.assertCanView(task.projectId, userId)`, so a user outside the project gets a `403`.
  - It resolves the user's access context via `projectAccessService.resolve` and enforces the task-level rule `canManage(access) || isCreator` before saving, so a project member who is neither a project manager nor the task creator cannot change the status.
- `apps/api/src/tasks/tasks.module.ts`: added `ProjectMembersModule` to imports, because the fixed service depends on `ProjectMembersService` (used by the same commit for the assignee feature).

Note: this fix predates this assessment's work. It was already committed to the repository before the task-assignment and activity-history work in this assessment began.

## Regression Prevention

E2E tests were added in `apps/api/test/tasks.e2e.spec.ts` (nested `describe('authorization regression')`) to prevent a reintroduction:

- **`refuses to let an outsider update task fields`** — an outsider with no project access cannot `PATCH /tasks/:taskId`; verifies the title was not modified. Protects `update()`'s `assertCanView` + `canManage || isCreator` rule.
- **`refuses to let an outsider update task status`** — an outsider cannot `PATCH /tasks/:taskId/status`; verifies the status stayed `TODO`. Protects the exact endpoint that was vulnerable (`updateStatus`).
- **`refuses to let an outsider delete a task`** — an outsider cannot `DELETE /tasks/:taskId`; the task still exists afterwards. Protects `remove()`'s `assertCanManage` rule.
- **`refuses to let a regular member edit a task they did not create`** — a project `MEMBER` who is neither the task creator nor a manager cannot `PATCH /tasks/:taskId`; verifies the title was not modified. Protects the task-level `canManage(access) || isCreator` rule.

Each test also verifies the resource was not modified/deleted where meaningful.

## Current Authorization Model

Task mutations route through `ProjectAccessService` (`apps/api/src/projects/project-access.service.ts`), which is the single point that decides whether a user may touch a project. Access comes from either an elevated organization role (`OWNER`/`ADMIN`) or an explicit project membership row.

- `assertCanView` — throws `403` unless the user can read the project. It is used as the authorization guard for task reads and for task mutations that first need project-level access validation.
- `assertCanManage` — throws `403` unless the user has an elevated organization role or `PROJECT_MANAGER`. Used for `DELETE /tasks/:taskId` and project configuration.
- Task-level rule: a non-manager user may mutate a task only when they are the task's `createdBy` (creator). This rule is layered on top of `assertCanView` for status updates and general updates.
- Assignment is additionally restricted: a non-manager may only assign/unassign themselves, and the assignee must be a member of the project.
