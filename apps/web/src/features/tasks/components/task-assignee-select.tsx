'use client';

import { toast } from 'sonner';
import type { UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjectMembers } from '@/features/projects/hooks';
import { useUpdateTask } from '../hooks';

const UNASSIGNED_VALUE = 'unassigned';

interface TaskAssigneeSelectProps {
  taskId: string;
  projectId: string;
  assignee: UserSummary | null;
}

export function TaskAssigneeSelect({ taskId, projectId, assignee }: TaskAssigneeSelectProps) {
  const members = useProjectMembers(projectId);
  const updateTask = useUpdateTask(taskId, projectId);

  const handleValueChange = (value: string) => {
    const assigneeId = value === UNASSIGNED_VALUE ? null : value;
    updateTask.mutate(
      { assigneeId },
      {
        onError: (error) => toast.error(error.message),
      },
    );
  };

  if (members.isPending) {
    return <Skeleton className="h-8 w-full" />;
  }

  if (members.isError) {
    return (
      <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
        {members.error.message}
      </p>
    );
  }

  return (
    <Select
      value={assignee?.id ?? UNASSIGNED_VALUE}
      disabled={updateTask.isPending}
      onValueChange={handleValueChange}
    >
      <SelectTrigger aria-label="Task assignee">
        <SelectValue placeholder="Assign to…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
        {members.data.map((member) => (
          <SelectItem key={member.user.id} value={member.user.id}>
            <span className="flex items-center gap-2">
              <Avatar user={member.user} size="sm" />
              {member.user.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}