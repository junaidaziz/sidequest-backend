import { ApiProperty } from '@nestjs/swagger';

/** Uniform `{ success: true }` acknowledgement for side-effecting admin-auth actions. */
export class AdminSuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}
