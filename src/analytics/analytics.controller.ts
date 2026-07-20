import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRangeQueryDto } from './dto/analytics-range-query.dto';
import { AnalyticsOverviewDto } from './dto/analytics-overview.dto';

/**
 * Admin analytics dashboard surface (Phase 12): a single overview aggregate and a
 * CSV export, both accepting an optional `from`/`to` window.
 *
 * Gated entirely by the RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`) using
 * the already-seeded `analytics.view` / `analytics.export` permission keys — no new
 * permission keys are introduced (the catalog is fixed). Thin: routing, guards, DTO
 * binding, and Swagger only — every aggregate lives in AnalyticsService.
 */
@ApiTags('admin-analytics')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid admin access token' })
@ApiForbiddenResponse({ description: 'Missing the required analytics.* permission' })
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('analytics/overview')
  @RequirePermission('analytics.view')
  @ApiOperation({
    summary:
      'Real KPI dashboard: users, completions, backlog, moderation, level/activation, ' +
      'device tokens, campaign rollup, live queue depth, and recent admin activity',
  })
  @ApiResponse({ status: 200, type: AnalyticsOverviewDto })
  @ApiResponse({ status: 400, description: 'Invalid range (bad ISO date, or from after to)' })
  getOverview(@Query() query: AnalyticsRangeQueryDto): Promise<AnalyticsOverviewDto> {
    return this.service.getOverview(query);
  }

  @Get('analytics/export')
  @RequirePermission('analytics.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="analytics.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'CSV export of the computed KPI numbers for the range' })
  @ApiResponse({ status: 200, description: 'CSV body (metric,value rows)' })
  @ApiResponse({ status: 400, description: 'Invalid range (bad ISO date, or from after to)' })
  exportCsv(@Query() query: AnalyticsRangeQueryDto): Promise<string> {
    return this.service.exportCsv(query);
  }
}
