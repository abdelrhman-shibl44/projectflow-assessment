# Assessment Notes

## System Understanding

ProjectFlow is a lightweight project and task tracker. It is a TypeScript monorepo with a NestJS + MongoDB API and a Next.js frontend that share one small package of domain types. This section summarises how the system is actually built, based on the repository as it stands.

### Architecture

- pnpm workspaces + Turborepo monorepo (TypeScript 5.9): `apps/api` (NestJS 11, Mongoose 8, MongoDB), `apps/web` (Next.js 16 App Router, React 19), and `packages/shared` (enums, constants, API response types). `packages/eslint-config` and `packages/tsconfig` hold shared tooling config.
- The API is layered uniformly: controller → service → Mongoose model. DTOs with `class-validator` validate at the boundary via a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`); controllers stay thin and business rules live in services.
- Cross-cutting behaviour is registered once in `AppModule`: a global `JwtAuthGuard` and a global `AllExceptionsFilter` that normalises every response into the `ApiErrorBody` shape (unexpected errors are logged and returned as a generic 500). `main.ts` adds helmet and CORS to `WEB_ORIGIN`, and boot fails fast when `MONGODB_URI` or `JWT_SECRET` is missing.
- Feature modules: `auth`, `users`, `organizations`, `organization-members`, `projects`, `project-members`, `tasks`, `task-activities`, `comments`, plus `common` and `database/seed.ts`.
- Tests are Jest + Supertest e2e suites in `apps/api` that boot the real `AppModule` against `mongodb-memory-server`; shared fixtures insert documents natively.

### Domain and Business Logic

- Domain model: Organization → Project → Task → Comment, with dedicated `OrganizationMember`/`ProjectMember` collections carrying roles and a `TaskActivity` store recording assignee changes.
- Membership lives in its own collections (not arrays on the parent documents) with unique compound indexes on the two foreign keys, so memberships can be indexed and queried directly.
- Task numbers are allocated per project from a per-project counter document (`task_counters.lastNumber`) using an atomic `$inc`, are monotonic, and are never reused after deletion; the `{ projectId, number }` unique index is a database-level backstop. (Made concurrency-safe during this assessment.)
- Assignment rules: any project member may assign or unassign themselves; managers and elevated organization roles may assign other project members; the assignee must be a member of the project; a non-manager member who is not the task creator cannot edit a task's other fields.
- Activity history records only assignee changes (`TASK_ASSIGNEE_CHANGED`): actor, previous and new assignee, and timestamp, served newest-first with names resolved in one batched user query.
- The activity record is inserted after the task save, and the two writes are deliberately non-atomic (documented tradeoff at `tasks.service.ts:155-161`).
- Comments are available to any user who can view the project; comment counts for a task list come from a single aggregation query rather than an N+1.
- `database/seed.ts` is repeatable: it clears the ProjectFlow collections and reinserts a development organization, users, projects, tasks, and comments.

### Authentication and Authorization

- Authentication is JWT bearer tokens with bcrypt (12 rounds) password hashing. `register` and `login` are `@Public()`; every other route requires a valid token via the globally registered `JwtAuthGuard`. The token carries `{ sub, email }` and `@CurrentUser('id')` exposes the caller to handlers. The default lifetime is 7 days; there is no refresh token or server-side revocation.
- Authorization funnels through `ProjectAccessService`, the single place that answers "may this user touch this project?": an elevated organization role (`OWNER`/`ADMIN`) or an explicit project membership row. `assertCanView` gates reads; `assertCanManage` gates configuration, membership changes, and task deletion.
- Task mutations layer a task-level rule on top of `assertCanView`: `canManage(access) || isCreator`. Assignment additionally requires `canManage || isSelfAssignment || isSelfUnassignment`, and the assignee must be a project member.
- Historical note: the original starter code shipped with `PATCH /tasks/:taskId/status` having no authorization at all — any authenticated user could change any task's status. That was fixed in commit `02f306b` before this assessment's feature work, and is now locked in by the `authorization regression` e2e suite. The current state is the fixed implementation; the original vulnerability is documented in `BUG_REPORT.md`, not present in the code.

### Frontend and Server State

- Next.js App Router frontend with thin routes; logic lives in `features/` (auth, projects, tasks, comments). Components are server components by default and opt into `"use client"` where hooks or interactivity are required.
- Server state uses TanStack Query 5. Query keys are centralised in `lib/query-keys.ts`; mutations seed the task detail via `setQueryData` and invalidate the affected project task list and activity timeline on success.
- One API client (`lib/api-client.ts`) owns the base URL, the Bearer header (token read from `localStorage`), query serialisation, and error parsing into `ApiError`.
- Forms use React Hook Form + Zod; the UI is Tailwind CSS 4 with Radix primitives, Phosphor icons, and Sonner toasts.
- Data fetching is entirely client-side. There is no Next.js middleware doing route-level auth; the authenticated app shell redirects to `/login` based on `useCurrentUser` and the presence of a token.

### Key Entity Relationships

- Organization 1-* Project (`projects.organizationId`)
- Organization 1-* OrganizationMember (user, role)
- Project 1-* ProjectMember (user, role)
- Project 1-* Task (per-project `number` and human-readable `key` such as `ENG-1`)
- Project 1-1 TaskCounter (per-project task sequence)
- Task 1-* Comment (`comments.taskId`)
- Task 1-* TaskActivity (`task_activities.taskId`)
- Task N-1 User assignee (`tasks.assigneeId`)
- User 1-* created projects/tasks/comments (`createdBy`/`authorId`)

### Risks and Weaknesses

1. **Non-atomic task update and activity write.** The task is saved, then the activity entry is inserted as a separate write; if the insert fails, the assignee is set correctly but the history entry is silently lost. Why it matters: this is the audit feature, so silent gaps weaken its core value. Fix now or later: later — the failure window at current scale is small, and a complete fix means replica-set transactions or an outbox. The tradeoff is documented and should be measured through observability.

2. **Offset pagination with exact counts on every list endpoint.** Tasks, comments, and activity all use `skip`/`limit` together with a `countDocuments`, so each list is two queries and deep pages become progressively more expensive. Why it matters: activity is the dataset most likely to grow, and this is the first thing that degrades. Fix now or later: later, activity first — while pages remain small the current code is fine, and the cursor plan is already sketched in the scaling section.

3. **Orphaned activity rows when a task is deleted.** `TasksService.remove` deletes the task and its comments but not its `task_activities` rows (`tasks.service.ts:203`). The timeline returns 404 once the task is gone, so the records are functionally invisible, but orphaned documents accumulate and inflate the collection. Why it matters: dataset hygiene and collection growth. Fix now or later: now — a single `deleteMany({ taskId })` is cheap, local, and stops the accumulation without any design change.

4. **Long-lived single JWT in localStorage.** Tokens default to a 7-day lifetime, live in `localStorage`, and there is no refresh/rotation or server-side revocation; logout only clears local storage. Why it matters: an XSS could exfiltrate the token and impersonate the user until expiry, and a leaked token has no kill switch. Fix now or later: later — full session/refresh-token support is cross-cutting, but shortening the lifetime and moving to cookie transport (with CSRF handling) are reasonable hardening follow-ups.

5. **Per-request authorization cost.** Every task read or mutation resolves the project and runs two membership queries (organization role + project role) inside `resolve()`, on top of the resource query itself. Why it matters: it is roughly three extra indexed queries per protected request and becomes measurable database load under growth. Fix now or later: later, once load demonstrates it — role caching or denormalisation are candidates, not worth it at current scale.

6. **Board truncates at 100 tasks.** The web app fetches project tasks at `pageSize: 100` (`tasks/api.ts`), so a project with more than 100 tasks silently drops the remainder from the board. Why it matters: it is a real product bug at scale and triggers without any visible error. Fix now or later: later-but-notable — server-side pagination or "load more" for the board, or at minimum an indication that the list is truncated.

## Code Review

Review the hypothetical `assignTask` implementation as a pull request.

**Verdict: Request changes** — the implementation has blocking authorization and business-rule issues. The requested fixes are driven by correctness, security, business rules, and consistency with the existing architecture; this is not a rewrite for its own sake.

### Blocking issues

1. **Missing project-level authorization.**

   The task is loaded without checking whether the caller can access the task's project. A user who knows a task ID could modify a task in a project they do not belong to.

   **Ask:** Enforce the existing `ProjectAccessService.assertCanView` check before allowing the mutation.

2. **Missing task-level assignment authorization.**

   `userId` is never used. The implementation does not distinguish project managers or elevated roles from regular members. Regular members must only assign or unassign themselves; authorized roles may assign other project members.

   **Ask:** Reuse the existing authorization rules (`canManage || isSelfAssignment || isSelfUnassignment`) rather than creating a separate permission model.

3. **No project-membership validation for the assignee.**

   `userModel.findById(assigneeId)` only proves the user exists globally — it does not prove the user belongs to the task's project. An assignee outside the project would allow an invalid task state.

   **Ask:** Validate project membership (via `projectMembersService.findExisting`) before allowing the assignment.

4. **Missing required activity history.**

   The task is saved directly without recording the previous assignee, new assignee, actor, type, or timestamp. This violates the task activity-history requirement and creates an incomplete audit trail.

   **Ask:** Use the existing `taskActivitiesService.recordAssigneeChange` path, called after a successful save, consistent with the established pattern.

5. **`userId` is unused.**

   This is the caller identity and is currently dead input. It is a symptom of the missing authorization and actor tracking rather than merely a style issue.

### Lower-priority observations

6. **Raw string IDs.**

   Existing code converts validated IDs to `Types.ObjectId` and types service methods accordingly. The review should ask the engineer to follow the existing convention.

7. **Missing `.exec()`.**

   Existing repository queries consistently use `.exec()`. Ask the engineer to follow the established Mongoose query convention for consistency.

8. **Input validation is not visible.**

   The example accepts raw strings directly. The actual API uses validated DTOs and the global `ValidationPipe`. Ask the engineer to ensure the endpoint uses the existing validated DTO pattern rather than accepting arbitrary IDs.

9. **Unnecessary user lookup.**

   The fetched user is only used for `user._id`, which is already represented by `assigneeId`. Once project-membership validation is performed, a separate global user lookup is not necessary unless additional user data is required.

## Scaling the Activity System

Context: at today's footprint (roughly 5,000 users) the activity system is deliberately small — one collection, one task-scoped read path, one supporting index — and that is the right call. Growth to ~500,000 users is a workload question more than a user-count question: activity volume tracks assignment frequency and active tasks, not logins. Every change below is justified by measured workload, latency, database load, or a product requirement — never by reaching 500k users in itself.

### Current design and why it is sufficient at current scale

- A single `task_activities` collection stores one document per assignee change (`taskId`, `actorId`, `type`, `previousAssigneeId`, `newAssigneeId`, timestamps), backed by the compound index `{ taskId: 1, createdAt: -1 }` (`task-activity.schema.ts:30`).
- `GET /tasks/:taskId/activity` authorizes via `assertCanView`, then runs a task-scoped `find().sort({ createdAt: -1 }).skip().limit()` plus `countDocuments` (`task-activities.service.ts:58-66`); actors and assignees are resolved in one batched `findManyByIds` per page (`task-activities.service.ts:76-99`).
- The web client fetches the timeline on mount via TanStack Query and invalidates it after an assignment mutation (`hooks.ts:65-78`).
- At this scale tasks accumulate few entries, writes are rare, and each read is a fast index-covered query; a cache, queue, or event stream would be complexity with no demonstrated need.

### First scaling concerns and immediate improvements

- **Deep offsets and exact totals.** `.skip()` and `countDocuments` are the first things to degrade as the collection grows — deep pages cost progressively more and every list runs a second count query. Treat both as measured problems: keep today's code while pages are small, and move to cursor pagination once deep pages or count cost show up (below). The timeline UI only needs the current page and a "has more" signal, not an exact total.
- **Write path.** Activity is a separate non-atomic insert after the task save (documented at `tasks.service.ts:155-161`). If assignment latency or occasional activity loss appears in metrics, move recording off the request path.
- **Observability now.** Collect activity latency percentiles, error rates, collection/index size, and slow queries so the changes below are introduced because data demands them.

### Pagination, query, and index strategy

- Query patterns stay scoped to the task and, if documents grow, project to only the fields the timeline renders; cross-task queries such as "all assignments by a user" need a different shape like `{ actorId: 1, createdAt: -1 }`, added only when a product query requires it.
- Switch to **cursor (keyset) pagination** when deep pages or pagination latency become measurable. The cursor order is `(createdAt DESC, _id DESC)`: `createdAt` alone is ambiguous under timestamp collisions, and the monotonic `_id` breaks ties deterministically.
- The cursor query filters below the current `(createdAt, _id)` tuple with `limit(pageSize + 1)` — the extra row signals "has next" without a count — and the supporting index evolves to `{ taskId: 1, createdAt: -1, _id: -1 }` so the sort stays index-served.

### Data growth, retention, and archiving

- Activity grows with assignments, so at 500k users it can become one of the largest collections — but only if kept unbounded. Whether that matters is a **product and audit decision**: how far back the timeline must remain available, and what must remain provable for compliance.
- Once that window is set and the hot collection affects query or maintenance costs, archive older records by `createdAt` in controlled batches via a scheduled background job so it does not compete with request traffic; object storage is a later archive tier only if long-term volume justifies it.

### When asynchronous processing and background jobs become justified

- A single indexed insert stays cheap even at 500k assignments, so a queue is never warranted by user count — it is justified when the write path becomes measurably expensive or a real downstream consumer (notifications, search indexing, analytics) appears.
- When that happens, keep the authoritative task update as the source of truth and process follow-up work asynchronously from a simple job/queue mechanism; a distributed event architecture is not needed unless workload and reliability requirements later demand it.

### Real-time updates

- The client refetches after its own mutation today, which is right for the current single-user model. SSE or WebSocket delivery is added only if the product requires seeing another user's assignment change without a reload; until then, query invalidation (with polling as an optional lightweight middle step) stays simpler.

### Caching

- Activity is append-only per task, so timeline pages are cache-friendly — but nothing is cache-backed today and that is fine. Add server-side caching only if measurements show repeated activity reads consume meaningful database resources, keyed by task and cursor with invalidation on new activity; TanStack Query already provides client-side caching, deduplication, and staleness, so a server cache must solve a demonstrated database or latency problem rather than duplicate that.

### Observability

- Track activity endpoint latency percentiles and error rate, `task_activities` collection/index size, database resource usage, slow queries, per-task activity counts as a hotspot proxy, and verify that the intended index is used as indexes evolve.
- If asynchronous processing is introduced later, add queue depth/lag and retry/failure counts; if caching, measure hit rate and its effect on database load. The non-atomic task-save/activity-write tradeoff must stay visible so activity-loss failures do not silently erode the audit trail.

### Evolution path from ~5k to ~500k users

- **Now (~5k):** keep the current design; add the baseline observability and establish the retention window while data is small.
- **As activity volume grows:** when deep pages, count cost, or latency become measurable, move to cursor pagination with the `{ taskId, createdAt, _id }` index and start scheduled archival; keep actor resolution batched and task queries narrowly scoped.
- **Mid scale (tens to hundreds of thousands):** introduce asynchronous processing only when request-path cost or real downstream consumers appear; cache only if reads measurably dominate.
- **High scale (~500k):** the same principles hold — scoped keyset queries, bounded hot data, batched resolution, measured access patterns. Sharding is a later MongoDB option and only if dataset size, hotspotting, or single-cluster throughput becomes a measured limitation; it is not warranted by the user count alone.

## If I Had Two More Days

Priorities, in order. Everything here targets something that concretely exists in the codebase.

1. **Make the activity write path unable to lose history.** Close the non-atomic gap between task save and activity insert (an outbox, or a transaction where a replica set is available) and delete orphaned `task_activities` rows on task removal. This protects the audit feature's core promise. The orphan cleanup is a one-line fix; the transactional piece is the bulk of the work.

2. **Add cursor (keyset) pagination to the activity timeline first.** Cursor of `(createdAt DESC, _id DESC)`, the `{ taskId, createdAt, _id }` index, and `hasMore` in place of an exact `countDocuments` — retiring `skip` + count on the dataset most likely to grow, then applying the same shape to tasks and comments if the client needs paging.

3. **Ship minimal observability.** A request-logging middleware (route, status, latency), a logged warning when the activity write fails, and a simple collection-size metric. This is the cheapest piece and it makes every later scaling decision evidence-based.

4. **Put a retention/archiving job in place.** Define the product window, then a scheduled job that moves older `task_activities` rows into an archive collection in bounded batches. Cheap to build now and it stops the largest dataset from growing unbounded from day one.

5. **Round out the test corners.** Add e2e coverage for comments (create/list authorization matrix), task deletion cleanup (both comments and activity are removed), task-list filter/sort combinations, and pagination edge cases (max page size, empty pages). The important business rules are already covered; this fills the remaining gaps.

6. **Frontend polish on real limitations.** Fix the 100-task board truncation (server-side paging or "load more"), add paging UI to the activity and comments timelines, and do a focused accessibility pass (focus management in dialogs/dropdowns, live-region announcements for status changes).
