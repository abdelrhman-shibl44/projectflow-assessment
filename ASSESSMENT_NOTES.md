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
