import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { AuditLogService } from './audit-log.service';
import { AuditLogPageDto } from './dto/audit-log-response.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * Read-only audit-log viewer. There is deliberately NO create/update/delete
 * route here — the immutability guarantee is enforced by simply never building
 * one (writes happen only via AuditLogService.record, called by other modules).
 */
@ApiTags('admin-audit-logs')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @RequirePermission('audit.view')
  @ApiOperation({ summary: 'List audit logs (paginated, filterable by actor/target/action/date)' })
  @ApiResponse({ status: 200, type: AuditLogPageDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 403, description: 'Missing audit.view permission' })
  list(@Query() query: QueryAuditLogsDto): Promise<AuditLogPageDto> {
    return this.service.list(query);
  }
}
