# AI Log

## Tools Used

- **opencode** CLI (model: `omniroute/opencode/big-pickle`) as the primary assistant for the whole assessment. It used its built-in tools: shell/command execution, Read, Write, Edit, Glob, Grep, Task subagents (explore/general), and WebFetch.

- Standard project toolchain, invoked through the assistant: `git`, `pnpm`, `turbo`, `jest`, `tsc`, and `prettier`.

## How AI Was Used

- **Repository inspection.** Mapped the monorepo (`apps/api` NestJS API, `apps/web` Next.js App Router frontend, and `packages/shared` shared types/enums), feature modules, schemas, DTOs, guards, global filters, test infrastructure (Jest + Supertest + `mongodb-memory-server`), and git history to separate starter code from assessment work.

- **Implementation guidance.** Helped implement the task-assignment and activity-history features, and the concurrency-safe task numbering (per-project counter, atomic `$inc` allocation, unique `{projectId, number}` index), within explicit constraints: no new external infrastructure and no rewriting existing authorization logic.

- **Code review.** Audited the authorization model, produced the hypothetical `assignTask` PR review, and fact-checked documentation claims against the actual source before writing them down.

- **Testing/debugging assistance.** Wrote and ran the e2e suites (`tasks`, `activities`, full API run), ran `pnpm typecheck`, and used `prettier` to keep test edits consistent and avoid unrelated formatting changes. Diagnosed and documented the production authorization bug and its fix.

- **Documentation assistance.** Drafted `BUG_REPORT.md`, all of `ASSESSMENT_NOTES.md` (Code Review, System Understanding, Scaling the Activity System, If I Had Two More Days), and this `AI_LOG.md`.

## Suggestions Rejected

- **Transactions for the task-save + activity-write pair.** Considered for atomicity, but not introduced for this assessment. The current development/test MongoDB setup is standalone, and making the write path transactional would require additional infrastructure/setup. The non-atomic tradeoff is documented, with observability identified as the next step.

- **Redis or an external queue for task numbering.** Rejected in favor of a per-project counter document allocated with an atomic `findOneAndUpdate` + `$inc`, with a unique index as a database backstop.

- **Kafka, microservices, CQRS, event sourcing, or Kubernetes for activity scaling.** Rejected as premature; the scaling answer deliberately keeps the current design and defers infrastructure until measured workload, latency, or real downstream consumers justify it.

- **Preemptive sharding of the activity collection.** Rejected; documented as a later option only if dataset size, hotspotting, or single-cluster throughput becomes a measured limitation.

- **SSE/WebSocket real-time activity delivery.** Rejected for now; client query invalidation remains the implementation until a product requirement for cross-user live updates exists.

- **Server-side caching of activity timelines now.** Rejected; TanStack Query already provides client-side caching/deduplication/staleness, and no measurement shows a server cache is needed.

- **Extra tests beyond the required scope.** For Task 6, frontend test infrastructure, unit tests, extra pagination/counter cases, and the optional manager-unassign test were not added in order to keep coverage focused on the important business rules within the assessment time limit.

## Generated Code Modified

AI-drafted code was reviewed, adjusted, and accepted by the candidate — it was not used unmodified.

- **Task assignment.** Backend rule `canManage || isSelfAssignment || isSelfUnassignment` layered on `ProjectAccessService.assertCanView`, plus the assignee-membership check and the frontend assignee control.

- **Activity history.** `task-activities` module recording assignee changes after task save, the newest-first timeline endpoint with batched actor resolution, and frontend timeline with query invalidation.

- **Concurrency-safe task numbering.** `TaskCounterSchema`, `TaskCountersService.allocateNextNumber` (fast `$inc` path and race-safe first-init path), the promoted unique index, and the `create()` change; refined through review to eliminate a concurrent-first-init duplicate scenario.

- **E2E tests.** Authorization regression tests, status/creator/business-rule tests, concurrent-numbering tests, and the no-activity-on-non-assignee-edit test; formatted with prettier and edited to remove unrelated hunks.

- **Documentation.** `BUG_REPORT.md` and `ASSESSMENT_NOTES.md` were drafted with AI and then revised by the candidate (including a substantial rewrite of the Scaling section) before being committed.

The candidate made all final decisions on scope, accepted/rejected changes, and all commits.
