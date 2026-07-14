import { ApiProperty } from '@nestjs/swagger';

/** Badge count for `GET /notifications/unread-count`. */
export class UnreadCountDto {
  @ApiProperty({ example: 3, description: 'Number of unread (readAt IS NULL) notifications.' })
  unreadCount!: number;
}

/** Result of a mark-read / read-all mutation. */
export class MarkReadResultDto {
  @ApiProperty({
    example: 5,
    description: 'How many notifications this call transitioned from unread to read.',
  })
  updated!: number;
}
