import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type TaskCounterDocument = HydratedDocument<TaskCounter>;

/**
 * Per-project task sequence. `lastNumber` is the highest task number that has
 * been handed out; the next created task gets `lastNumber + 1`.
 *
 * The unique index on `projectId` guarantees each project has at most one
 * counter, which is what makes lazy initialization race-safe: concurrent
 * creators both try to insert, exactly one wins, and the rest proceed to the
 * atomic `$inc` below.
 */
@Schema({ timestamps: true, collection: 'task_counters' })
export class TaskCounter {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  projectId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  lastNumber: number;

  createdAt: Date;
  updatedAt: Date;
}

export const TaskCounterSchema = SchemaFactory.createForClass(TaskCounter);

TaskCounterSchema.index({ projectId: 1 }, { unique: true });
