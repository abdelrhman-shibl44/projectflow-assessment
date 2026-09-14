'use client';

import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr';
import type { TaskActivityEntry } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/format';
import { useTaskActivity } from '../hooks';

function describeChange(activity: TaskActivityEntry) {
  const { previousAssignee, newAssignee } = activity;

  if (previousAssignee === null && newAssignee !== null) {
    return <>assigned {newAssignee.name}</>;
  }

  if (previousAssignee !== null && newAssignee !== null) {
    const from = previousAssignee.id === activity.actor.id ? 'themselves' : previousAssignee.name;
    return (
      <>
        changed the assignee from {from} to {newAssignee.name}
      </>
    );
  }

  return <>removed the assignee</>;
}

export function TaskActivityList({ taskId }: { taskId: string }) {
  const { data, isPending, isError, error } = useTaskActivity(taskId);

  return (
    <section className="space-y-4" aria-label="Activity">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        {data ? (
          <span className="rounded-sm bg-surface-strong px-1.5 text-[11px] text-muted-foreground">
            {data.total}
          </span>
        ) : null}
      </div>

      {isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
          {error.message}
        </p>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwiseIcon}
          title="No activity yet"
          description="Assignment changes will appear here."
        />
      ) : (
        <ul className="space-y-4">
          {data.items.map((activity) => (
            <li key={activity.id} className="flex gap-3">
              <Avatar user={activity.actor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">{activity.actor.name}</span>{' '}
                  {describeChange(activity)}{' '}
                  <span className="text-subtle-foreground">
                    {formatRelativeTime(activity.createdAt)}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
