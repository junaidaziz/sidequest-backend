import { ApiProperty } from '@nestjs/swagger';
import { MissionResponseDto } from './mission-response.dto';

/** A saved mission in the mobile short-field shape, plus when it was saved. */
export class SavedMissionDto extends MissionResponseDto {
  @ApiProperty({ format: 'date-time', description: 'When the caller saved this mission.' })
  savedAt!: Date;
}

/** Paginated, most-recently-saved-first envelope for `GET /missions/saved`. */
export class PaginatedSavedMissionsDto {
  @ApiProperty({ type: [SavedMissionDto] })
  items!: SavedMissionDto[];

  @ApiProperty({ example: 12, description: 'Total saved missions for the caller.' })
  total!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}
