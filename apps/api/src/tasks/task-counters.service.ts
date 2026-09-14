import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task, type TaskDocument } from './schemas/task.schema';
import { TaskCounter, type TaskCounterDocument } from './schemas/task-counter.schema';

/**
 * Allocates monotonically increasing task numbers per project.
 *
 * The database is the source of truth: `task_counters.lastNumber` is updated
 * with an atomic `$inc`, so concurrent creators can never observe the same
 * number. This avoids the `countDocuments() + 1` read-then-write race.
 *
 * No MongoDB transactions or external services are required: a single counter
 * document per project, protected by a unique index on `projectId`, is enough.
 * The unique `tasks (projectId, number)` index is a final backstop invariant,
 * not the primary concurrency mechanism.
 */
@Injectable()
export class TaskCountersService {
  constructor(
    @InjectModel(TaskCounter.name) private readonly taskCounterModel: Model<TaskCounterDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  /**
   * Returns the next task number for a project.
   *
   * Fast path: the counter already exists, so one atomic `$inc` is all we need.
   *
   * First call for a project: the counter is seeded from the highest existing
   * task number (0 when there are none) so the next allocation is max + 1 and
   * never reuses a number. Seeding is race-safe because the unique `projectId`
   * index lets exactly one concurrent request create the counter; the others
   * ignore the duplicate key and use the winner's counter. Every request then
   * goes through the same atomic `$inc` below, so the numbers handed out are
   * distinct no matter how many requests race the initialization.
   */
  async allocateNextNumber(projectId: Types.ObjectId): Promise<number> {
    const allocated = await this.taskCounterModel
      .findOneAndUpdate({ projectId }, { $inc: { lastNumber: 1 } }, { new: true })
      .exec();

    if (allocated) {
      return allocated.lastNumber;
    }

    return this.allocateFirst(projectId);
  }

  private async allocateFirst(projectId: Types.ObjectId): Promise<number> {
    const latestTask = await this.taskModel
      .findOne({ projectId })
      .sort({ number: -1 })
      .select({ number: 1 })
      .exec();

    try {
      await this.taskCounterModel
        .updateOne(
          { projectId },
          { $setOnInsert: { lastNumber: latestTask?.number ?? 0 } },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      // Lost the initialization race: another request just created the
      // counter. Fall through and allocate from the winner's counter.
    }

    const counter = await this.taskCounterModel
      .findOneAndUpdate({ projectId }, { $inc: { lastNumber: 1 } }, { new: true })
      .exec();

    return counter!.lastNumber;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
