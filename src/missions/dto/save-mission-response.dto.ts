import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of a save/unsave toggle. `saved` reflects the resulting persisted
 * state (true after a save, false after an unsave), not whether a row was
 * actually created/deleted — both endpoints are idempotent, so a no-op save
 * still returns `{ saved: true }` and a no-op unsave still returns
 * `{ saved: false }`.
 */
export class SaveMissionResponseDto {
  @ApiProperty({
    example: true,
    description: 'The resulting saved state for this (user, mission) pair.',
  })
  saved!: boolean;
}
