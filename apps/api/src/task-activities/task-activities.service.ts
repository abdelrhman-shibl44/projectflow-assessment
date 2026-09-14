import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  type Paginated,
  type TaskActivityEntry,
  TASK_ACTIVITY_TYPE_ASSIGNEE_CHANGED,
} from '@projectflow/shared';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';
import { toUserSummary } from '../common/utils/serialize';
import { ProjectAccessService } from '../projects/project-access.service';
import { Task, type TaskDocument } from '../tasks/schemas/task.schema';
import { UsersService } from '../users/users.service';
import { TaskActivity, type TaskActivityDocument } from './schemas/task-activity.schema';

/**
 * Persists and serves the task activity timeline.
 *
 * Deliberately independent from `TasksService` so there is no module cycle:
 * it loads the task directly and authorizes through `ProjectAccessService`.
 */
@Injectable()
export class TaskActivitiesService {
  constructor(
    @InjectModel(TaskActivity.name)
    private readonly activityModel: Model<TaskActivityDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly projectAccessService: ProjectAccessService,
    private readonly usersService: UsersService,
  ) {}

  async recordAssigneeChange(input: {
    taskId: Types.ObjectId;
    actorId: Types.ObjectId;
    previousAssigneeId: Types.ObjectId | null;
    newAssigneeId: Types.ObjectId | null;
  }): Promise<void> {
    await this.activityModel.create({
      taskId: input.taskId,
      actorId: input.actorId,
      type: TASK_ACTIVITY_TYPE_ASSIGNEE_CHANGED,
      previousAssigneeId: input.previousAssigneeId,
      newAssigneeId: input.newAssigneeId,
    });
  }

  async findByTask(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.projectAccessService.assertCanView(task.projectId, userId);

    const [activities, total] = await Promise.all([
      this.activityModel
        .find({ taskId })
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .exec(),
      this.activityModel.countDocuments({ taskId }),
    ]);

    return {
      items: await this.toEntries(activities),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async toEntries(activities: TaskActivityDocument[]): Promise<TaskActivityEntry[]> {
    if (activities.length === 0) {
      return [];
    }

    const seen = new Set<string>();
    const userIds = activities.flatMap((activity) =>
      [activity.actorId, activity.previousAssigneeId, activity.newAssigneeId].filter(
        (id): id is Types.ObjectId => {
          if (id == null) {
            return false;
          }
          const key = id.toString();
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        },
      ),
    );

    const users = await this.usersService.findManyByIds(userIds);
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    return activities.flatMap((activity) => {
      const actor = usersById.get(activity.actorId.toString());
      if (!actor) {
        return [];
      }
      const previousAssignee = activity.previousAssigneeId
        ? (usersById.get(activity.previousAssigneeId.toString()) ?? null)
        : null;
      const newAssignee = activity.newAssigneeId
        ? (usersById.get(activity.newAssigneeId.toString()) ?? null)
        : null;

      return [
        {
          id: activity._id.toString(),
          taskId: activity.taskId.toString(),
          type: activity.type as TaskActivityEntry['type'],
          actor: toUserSummary(actor),
          previousAssignee: previousAssignee ? toUserSummary(previousAssignee) : null,
          newAssignee: newAssignee ? toUserSummary(newAssignee) : null,
          createdAt: activity.createdAt.toISOString(),
        },
      ];
    });
  }
}
