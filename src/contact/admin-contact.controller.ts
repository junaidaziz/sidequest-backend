import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { ContactActionContext, ContactService } from './contact.service';
import {
  ContactSubmissionDto,
  ContactSubmissionPageDto,
} from './dto/contact-submission-response.dto';
import { ListContactSubmissionsQueryDto } from './dto/list-contact-submissions-query.dto';
import { UpdateContactSubmissionDto } from './dto/update-contact-submission.dto';

/**
 * Admin triage of contact-form submissions (closed-beta admin tooling). Gated by
 * the RBAC system: reads require `contact.view`, the status update requires
 * `contact.manage`. Thin: routing, guards, DTO binding, Swagger.
 */
@ApiTags('admin-contact')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid admin access token' })
@ApiForbiddenResponse({ description: 'Missing the required contact.* permission' })
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/contact-submissions')
export class AdminContactController {
  constructor(private readonly service: ContactService) {}

  @Get()
  @RequirePermission('contact.view')
  @ApiOperation({ summary: 'List / filter / paginate contact submissions' })
  @ApiResponse({ status: 200, type: ContactSubmissionPageDto })
  list(@Query() query: ListContactSubmissionsQueryDto): Promise<ContactSubmissionPageDto> {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermission('contact.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'View a single contact submission' })
  @ApiResponse({ status: 200, type: ContactSubmissionDto })
  @ApiResponse({ status: 404, description: 'Contact submission not found' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<ContactSubmissionDto> {
    return this.service.getById(id);
  }

  @Patch(':id')
  @RequirePermission('contact.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a contact submission’s triage status' })
  @ApiResponse({ status: 200, type: ContactSubmissionDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'Contact submission not found' })
  updateStatus(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactSubmissionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<ContactSubmissionDto> {
    return this.service.updateStatus(id, dto, this.ctx(actor, ip, ua));
  }

  private ctx(actor: AuthAdmin, ip: string, ua?: string): ContactActionContext {
    return { actorAdminUserId: actor.adminUserId, ipAddress: ip, userAgent: ua ?? null };
  }
}
