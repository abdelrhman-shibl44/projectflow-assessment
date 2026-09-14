# Assessment Notes

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

Context: at today's footprint (roughly 5,000 users) the activity system is deliberately small — one collection, one task-scoped read path, and one supporting compound index — and that is the right call. Growth to around 500,000 users is a workload question more than a user-count question: activity volume tracks assignment frequency and the number of active tasks, not logins. The plan below is therefore driven by measurable workload changes rather than the user count alone.

### Current design and why it is sufficient at current scale

- A single `task_activities` collection stores one document per assignee change (`taskId`, `actorId`, `type`, `previousAssigneeId`, `newAssigneeId`, timestamps), backed by the compound index `{ taskId: 1, createdAt: -1 }` (`task-activity.schema.ts:30`).

- `GET /tasks/:taskId/activity` authorizes via `assertCanView`, then runs a task-scoped `find().sort({ createdAt: -1 }).skip().limit()` plus `countDocuments` (`task-activities.service.ts:58-66`).

- Actors and assignees are resolved in one batched `findManyByIds` per page of results, avoiding one user query per activity (`task-activities.service.ts:76-99`).

- The web client fetches the timeline on mount via TanStack Query and invalidates it after an assignment mutation (`hooks.ts:65-78`).

At this scale, a task is expected to accumulate only a small number of assignment entries, writes are relatively infrequent, and the task-scoped query is efficiently supported by the existing index. Introducing a cache, queue, or event stream now would add operational complexity without a demonstrated need. The goal is to preserve this simple baseline for as long as it remains sufficient.

### First scaling concerns and immediate improvements

- **Deep offset pagination.** `.skip()` becomes progressively less attractive as requested pages get deeper because the database must advance past earlier results. This is likely to become a concern before the activity write path does, but it should be treated as a measured performance problem rather than an automatic reason to change the implementation today.

- **Exact totals.** `countDocuments` adds a second database operation to every activity request. As activity collections and request volume grow, measuring the cost of this count will determine whether the UI still needs an exact total. If it becomes expensive and the product does not require an exact count, the API can return only the current page and whether another page exists.

- **Write path.** Activity is currently inserted separately after the task save (documented tradeoff at `tasks.service.ts:155-161`). If assignment latency increases because activity recording or additional downstream work becomes expensive, recording can be moved away from the request path. That change should be driven by measured latency or new consumers rather than introduced preemptively.

- **Observability.** Start collecting simple signals such as activity endpoint latency percentiles, error rates, collection/index size, and slow-query information. This gives the team evidence for when the next optimization is actually necessary.

### Pagination, query, and index strategy

- Keep the current offset pagination while activity pages remain small. As activity volume grows and deep pages or increasing pagination latency become measurable, replace offset pagination with **cursor (keyset) pagination**.

- The cursor should use a stable ordering of `(createdAt DESC, _id DESC)`. `createdAt` alone can be ambiguous when multiple records have the same timestamp; `_id` provides a deterministic tie-breaker.

- The query would remain scoped to the task, for example:

  `find({ taskId, $or: [ { createdAt: { $lt: c } }, { createdAt: c, _id: { $lt: i } } ] }).sort({ createdAt: -1, _id: -1 }).limit(pageSize + 1)`

  The extra record indicates whether another page exists without requiring an exact total.

- The supporting index would evolve to `{ taskId: 1, createdAt: -1, _id: -1 }` to support the task filter and stable sort efficiently.

- Project only the fields required by the timeline if activity documents or responses become larger over time.

- Cross-task queries, such as "all assignments by a user", would require a different index shape such as `{ actorId: 1, createdAt: -1 }`. That index should be added only when the product introduces such a query.

### Data growth, retention, and archiving

- At 500k users, `task_activities` could become one of the largest collections in the system, but the actual size depends on how frequently assignments change and how long history is retained.

- Retention is primarily a **product and audit decision**: how far back must the task timeline remain available, and how long must historical records remain provable for operational or compliance purposes?

- Once a retention policy exists and the hot collection becomes large enough to affect query or maintenance costs, older records can be moved by `createdAt` into a separate archive collection. A scheduled background job can perform this work in controlled batches so it does not compete heavily with normal request traffic.

- If long-term historical data eventually becomes much larger than the operational dataset, cheaper object storage can be considered as a later archive tier. This should be introduced only when the volume and access pattern justify the additional storage layer.

### When asynchronous processing and background jobs become justified

- The trigger is **cost on the request path or genuine downstream consumers**, not simply reaching 500k users. A single indexed activity insert remains a small operation; adding a queue only because the application is larger would create unnecessary complexity.

- Background processing becomes justified if activity recording or new activity-driven work causes noticeable request latency, or if other features begin consuming activity events for notifications, analytics, search indexing, or similar purposes.

- At that point, the authoritative task update should remain the source of truth while follow-up work is processed asynchronously. A simple job/queue mechanism is sufficient initially; a distributed event architecture is not necessary unless workload and reliability requirements eventually demand it.

### Real-time updates

- Today the client refetches the activity timeline after its own assignment mutation. This is appropriate for the current single-user interaction model.

- Live delivery through SSE or WebSocket becomes justified only if the product requires users viewing the same task to see another user's assignment change without refreshing.

- Until that requirement exists, normal query invalidation remains simpler. If a lightweight near-real-time experience is required before a push architecture is justified, polling can be considered first.

### Caching

- Activity is append-only per task, so previously fetched timeline pages are relatively cache-friendly. However, there is no evidence that server-side caching is currently needed.

- Add server-side caching only if measurements show that repeated activity reads are consuming meaningful database resources. A short-lived cache keyed by task and pagination cursor could reduce repeated reads, with invalidation when new activity is created.

- TanStack Query already provides client-side caching, deduplication, and staleness management, so server-side caching should solve a demonstrated database or latency problem rather than duplicate functionality unnecessarily.

### Observability

- Track the activity endpoint's latency percentiles and error rate, `task_activities` collection and index size, database resource usage, slow queries, and per-task activity counts to identify unusually active tasks.

- Monitor query plans as indexes evolve to ensure the intended index is actually being used.

- If asynchronous processing is introduced later, add queue depth, processing latency, retry/failure counts, and queue lag.

- If caching is introduced later, measure cache hit rate and its effect on database load.

- The current non-atomic task-save/activity-write tradeoff should also remain visible in operational monitoring so failures in activity recording do not silently become a long-term audit-data problem.

### Evolution path from ~5k to ~500k users

- **Now (~5k):** keep the current design. Add basic latency, error-rate, and collection-size observability. Keep offset pagination while activity pages remain small, and establish the product's retention requirements before the dataset grows substantially.

- **As activity volume grows:** when deep pagination or query latency becomes measurable, move to cursor pagination and the `{ taskId, createdAt, _id }` index shape. Introduce scheduled archival when the hot collection becomes unnecessarily large. Keep actor resolution batched and task queries narrowly scoped.

- **Mid scale (tens to hundreds of thousands):** introduce asynchronous processing only when the request path becomes expensive or real downstream consumers appear. Add caching or additional projections only when read load demonstrates a meaningful benefit.

- **High scale (~500k):** retain the same core principles — task-scoped keyset queries, bounded hot data, batched related-user resolution, and measured database access patterns. Sharding is a later MongoDB option only if dataset size, workload distribution, or single-cluster throughput becomes a measured limitation. It should not be introduced merely because the user count reached 500k.
