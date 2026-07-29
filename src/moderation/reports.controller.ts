import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { CreateReportDto } from './dto/create-report.dto';
import { CreateReportResponseDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

/**
 * Consumer-facing reporting surface (P0 gap #6). Separate from the admin
 * `ModerationController` (which is entirely `AdminJwtAuthGuard`-gated): this lets
 * a regular authenticated user file a report, which hides the target from their
 * own view and — on a second distinct reporter — globally. Thin: routing, guard,
 * DTO binding, throttle, and Swagger only; every rule lives in ReportsService.
 */
@ApiTags('reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  /**
   * File a report against another user's content or account. Reports are an abuse
   * surface, so this route is throttled tighter than the global default (10/60s)
   * — in line with the other sensitive side-effecting write routes in this API.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'File a report — hides the target for the reporter; a 2nd distinct reporter hides it globally',
  })
  @ApiResponse({ status: 201, type: CreateReportResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid body, or reporting your own account' })
  @ApiResponse({ status: 404, description: 'Report target not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  createReport(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportDto,
  ): Promise<CreateReportResponseDto> {
    return this.service.createReport(user.userId, dto);
  }
}
