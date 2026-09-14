import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { UsersModule } from '../users/users.module';
import { TaskActivity, TaskActivitySchema } from './schemas/task-activity.schema';
import { TaskActivitiesController } from './task-activities.controller';
import { TaskActivitiesService } from './task-activities.service';

/**
 * Self-contained so it can be consumed by `TasksModule` without a module
 * cycle: it registers its own `Task` model reference for authorization.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TaskActivity.name, schema: TaskActivitySchema },
      { name: Task.name, schema: TaskSchema },
    ]),
    ProjectsModule,
    UsersModule,
  ],
  controllers: [TaskActivitiesController],
  providers: [TaskActivitiesService],
  exports: [TaskActivitiesService],
})
export class TaskActivitiesModule {}
