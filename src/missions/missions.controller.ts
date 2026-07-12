import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { GenerateMissionsDto } from './dto/generate-missions.dto';
import { GenerateMissionsResponseDto } from './dto/mission-response.dto';
import { SaveMissionResponseDto } from './dto/save-mission-response.dto';
import { MissionsService } from './missions.service';

@ApiTags('missions')
@Controller('missions')
export class MissionsController {
  constructor(private readonly missionsService: MissionsService) {}

  /**
   * Public by design: this is the first API call the app makes after context
   * selection, before any account or guest session exists — so no JwtAuthGuard.
   * The global throttler default applies.
   */
  @Post('generate')
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
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Mission not found or inactive' })
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
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  unsaveMission(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
  ): Promise<SaveMissionResponseDto> {
    return this.missionsService.unsaveMission(user.userId, missionId);
  }
}
