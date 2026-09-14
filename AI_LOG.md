# AI Log

## Tools Used

- **opencode** CLI (model: `omniroute/opencode/big-pickle`) as the primary AI coding assistant during the assessment. It used its built-in tools: shell/command execution, Read, Write, Edit, Glob, Grep, Task subagents (explore/general), and WebFetch.

- Standard project toolchain, invoked through the assistant: `git`, `pnpm`, `turbo`, `jest`, `tsc`, and `prettier`.

## How AI Was Used

- **Repository inspection.** Mapped the monorepo (`apps/api` NestJS API, `apps/web` Next.js App Router frontend, and `packages/shared` shared types/enums), feature modules, schemas, DTOs, guards, global filters, test infrastructure (Jest + Supertest + `mongodb-memory-server`), and git history to separate starter code from assessment work.

- **Implementation guidance.** Helped implement the task-assignment and activity-history features, and the concurrency-safe task numbering (per-project counter, atomic `$inc` allocation, unique `{projectId, number}` index), within explicit constraints: no new external infrastructure and no rewriting existing authorization logic.

- **Code review.** Audited the authorization model, produced the hypothetical `assignTask` PR review, and verified documentation claims against the actual source before they were documented.

- **Testing/debugging assistance.** Helped write and run the e2e suites (`tasks`, `activities`, and the full API run), ran `pnpm typecheck`, and used `prettier` to keep test edits consistent and avoid unrelated formatting changes. Diagnosed and documented the production authorization bug and its fix.

- **Documentation assistance.** Drafted `BUG_REPORT.md`, substantial portions of `ASSESSMENT_NOTES.md` (including Code Review, System Understanding, Scaling the Activity System, and If I Had Two More Days), and this `AI_LOG.md`.

## Suggestions Rejected

- **Transactions for the task-save + activity-write pair.** Considered for atomicity, but not introduced for this assessment. The current development/test MongoDB setup is standalone, and making the write path transactional would require additional infrastructure/setup. The non-atomic tradeoff is documented, with observability identified as the next step.

- **Redis or an external queue for task numbering.** Rejected in favor of a per-project counter document allocated with an atomic `findOneAndUpdate` + `$inc`, with a unique index as a database backstop.

- **Kafka, microservices, CQRS, event sourcing, or Kubernetes for activity scaling.** Rejected as premature; the scaling answer deliberately keeps the current design and defers infrastructure until measured workload, latency, or real downstream consumers justify it.

- **Preemptive sharding of the activity collection.** Rejected; documented as a later option only if dataset size, hotspotting, or single-cluster throughput becomes a measured limitation.
