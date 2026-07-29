import { ApiProperty } from '@nestjs/swagger';
import { ContactSubmissionStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

/** Admin status transition for a contact submission. */
export class UpdateContactSubmissionDto {
  @ApiProperty({ enum: ContactSubmissionStatus, description: 'New triage status.' })
  @IsEnum(ContactSubmissionStatus)
  status!: ContactSubmissionStatus;
}
