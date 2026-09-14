import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { ProjectsModule } from '../projects/projects.module';
import { TaskActivitiesModule } from '../task-activities/task-activities.module';
import { UsersModule } from '../users/users.module';
import { ProjectMembersModule } from '../project-members/project-members.module';
import { TaskCountersService } from './task-counters.service';
import { TaskCounter, TaskCounterSchema } from './schemas/task-counter.schema';
import { Task, TaskSchema } from './schemas/task.schema';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: TaskCounter.name, schema: TaskCounterSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
    ProjectsModule,
    ProjectMembersModule,
    TaskActivitiesModule,
    UsersModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskCountersService],
  exports: [TasksService, TaskCountersService, MongooseModule],
})
export class TasksModule {}
