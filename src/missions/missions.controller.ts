import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GenerateMissionsDto } from './dto/generate-missions.dto';
import { GenerateMissionsResponseDto } from './dto/mission-response.dto';
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
}
