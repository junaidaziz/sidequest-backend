import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { GenerateMissionsDto } from './dto/generate-missions.dto';
import { GenerateMissionsResponseDto, MissionResponseDto } from './dto/mission-response.dto';
import { SaveMissionResponseDto } from './dto/save-mission-response.dto';
import { ListSavedMissionsQueryDto } from './dto/list-saved-missions-query.dto';
import { PaginatedSavedMissionsDto } from './dto/saved-mission-response.dto';
import { MissionsService } from './missions.service';

/** Unauthenticated and hit on every context-selection screen — tighter than
 * the global 100/60s default, generous enough for legitimate shuffle taps. */
const GENERATE_THROTTLE = { default: { limit: 30, ttl: 60_000 } } as const;

@ApiTags('missions')
@Controller('missions')
export class MissionsController {
  constructor(private readonly missionsService: MissionsService) {}

  /**
   * Public by design: this is the first API call the app makes after context
   * selection, before any account or guest session exists — so no JwtAuthGuard.
   */
  @Post('generate')
  @Throttle(GENERATE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate up to 3 random missions matching the onboarding context',
  })
  @ApiResponse({ status: 200, type: GenerateMissionsResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — a field is outside its allowed set',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded — retry after the window resets',
  })
  generate(@Body() dto: GenerateMissionsDto): Promise<GenerateMissionsResponseDto> {
    return this.missionsService.generate(dto);
  }

  /**
   * The caller's saved missions, newest-saved-first. Excludes missions that
   * were deactivated after being saved — see MissionsService.listSaved().
   */
  @Get('saved')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's saved missions" })
  @ApiResponse({ status: 200, type: PaginatedSavedMissionsDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  listSaved(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSavedMissionsQueryDto,
  ): Promise<PaginatedSavedMissionsDto> {
    return this.missionsService.listSaved(user.userId, query);
  }

  /**
   * Fetch a single mission by id, in the same shape as items from `generate`.
   * Works whether or not the mission is in the caller's saved list. Declared
   * AFTER `GET /missions/saved` so the static `saved` route is matched first and
   * this dynamic `:missionId` route never shadows it.
   *
   * Public by design, matching `generate`'s auth posture: this backs the
   * unauthenticated challenge/deep-link flow where a mission detail is opened
   * before any guest or account session exists — so no JwtAuthGuard. It exposes
   * only curated, non-personal mission content (identical to what `generate`
   * already returns unauthenticated), so nothing user-specific leaks.
   */
  @Get(':missionId')
  @ApiParam({ name: 'missionId', format: 'uuid' })
  @ApiOperation({ summary: 'Fetch a single mission by id' })
  @ApiResponse({ status: 200, type: MissionResponseDto })
  @ApiResponse({ status: 400, description: 'missionId is not a valid UUID' })
  @ApiResponse({ status: 404, description: 'Mission not found or inactive' })
  getMission(@Param('missionId', ParseUUIDPipe) missionId: string): Promise<MissionResponseDto> {
    return this.missionsService.getById(missionId);
  }

  /**
   * Bookmark a mission for later ("Save for later"). Idempotent: saving an
   * already-saved mission is a no-op that still returns `{ saved: true }`, never
   * a conflict. Cheap and idempotent, so the global throttle default is fine.
   */
  @Post(':missionId/save')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'missionId', format: 'uuid' })
  @ApiOperation({ summary: 'Save (bookmark) a mission for the current user — idempotent' })
  @ApiResponse({ status: 200, type: SaveMissionResponseDto })
  @ApiResponse({ status: 400, description: 'missionId is not a valid UUID' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Mission not found or inactive' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  saveMission(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
  ): Promise<SaveMissionResponseDto> {
    return this.missionsService.saveMission(user.userId, missionId);
  }

  /**
   * Remove a mission bookmark. Idempotent: un-saving a mission that was never
   * saved is a no-op that still returns `{ saved: false }`, never a 404 for the
   * missing save. Cheap and idempotent, so the global throttle default is fine.
   */
  @Delete(':missionId/save')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'missionId', format: 'uuid' })
  @ApiOperation({ summary: 'Unsave (remove bookmark) a mission for the current user — idempotent' })
  @ApiResponse({ status: 200, type: SaveMissionResponseDto })
  @ApiResponse({ status: 400, description: 'missionId is not a valid UUID' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  unsaveMission(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
  ): Promise<SaveMissionResponseDto> {
    return this.missionsService.unsaveMission(user.userId, missionId);
  }
}
