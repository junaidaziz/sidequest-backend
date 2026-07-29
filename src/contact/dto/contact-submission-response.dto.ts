import { ApiProperty } from '@nestjs/swagger';
import { ContactSubmission, ContactSubmissionStatus } from '@prisma/client';

/** Ack returned by the public `POST /contact` — deliberately minimal. */
export class ContactSubmissionAckDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ format: 'uuid', description: 'Id of the persisted submission.' })
  id!: string;
}

/** Full admin-facing view of a contact submission. */
export class ContactSubmissionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  topic!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ enum: ContactSubmissionStatus })
  status!: ContactSubmissionStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(row: ContactSubmission): ContactSubmissionDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      topic: row.topic,
      message: row.message,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** Paginated admin list of contact submissions. */
export class ContactSubmissionPageDto {
  @ApiProperty({ type: [ContactSubmissionDto] })
  items!: ContactSubmissionDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
