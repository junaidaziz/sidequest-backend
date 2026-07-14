import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

/** A single in-app notification. */
export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ example: 'Task accepted' })
  title!: string;

  @ApiProperty({ example: 'Alex accepted your task "Buy groceries".' })
  body!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Deep-link target, e.g. { "screen": "task-detail", "taskId": "..." }.',
    example: { screen: 'task-detail', taskId: '3f1c...' },
  })
  data!: Record<string, unknown> | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the caller marked this read; null while unread.',
  })
  readAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/** Paginated, newest-first envelope for `GET /notifications`. */
export class PaginatedNotificationsDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({ example: 42, description: 'Total notifications for the caller.' })
  total!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}
