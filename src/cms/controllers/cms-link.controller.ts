import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../../rbac/guards/permission.guard';
import { ReorderDto } from '../dto/common.dto';
import { CreateCmsLinkDto, UpdateCmsLinkDto } from '../dto/cms-content.dto';
import { CmsLinkDto } from '../dto/cms-response.dto';
import { CmsLinkService } from '../services/cms-link.service';
import { buildCtx } from './cms-controller.util';

@ApiTags('admin-cms-links')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/links')
export class CmsLinkController {
  constructor(private readonly service: CmsLinkService) {}

  @Get()
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'List all nav/footer/social/legal links (drafts included)' })
  @ApiResponse({ status: 200, type: [CmsLinkDto] })
  list(): Promise<CmsLinkDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'Get a link by id' })
  @ApiResponse({ status: 200, type: CmsLinkDto })
  @ApiResponse({ status: 404, description: 'Link not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsLinkDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Create a link (starts as Draft)' })
  @ApiResponse({ status: 201, type: CmsLinkDto })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsLinkDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto> {
    return this.service.create(actor, dto, buildCtx(ip, ua));
  }

  @Patch('reorder')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Reorder links by sortOrder' })
  @ApiResponse({ status: 200, type: [CmsLinkDto] })
  reorder(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: ReorderDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto[]> {
    return this.service.reorder(actor, dto.orderedIds, buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Update a link' })
  @ApiResponse({ status: 200, type: CmsLinkDto })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsLinkDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto> {
    return this.service.update(actor, id, dto, buildCtx(ip, ua));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Soft-delete a link' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  remove(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<void> {
    return this.service.remove(actor, id, buildCtx(ip, ua));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Publish a link' })
  @ApiResponse({ status: 200, type: CmsLinkDto })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Unpublish a link' })
  @ApiResponse({ status: 200, type: CmsLinkDto })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
