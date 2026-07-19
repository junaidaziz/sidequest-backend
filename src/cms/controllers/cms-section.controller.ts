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
import { CreateCmsSectionDto, UpdateCmsSectionDto } from '../dto/cms-content.dto';
import { CmsSectionDto } from '../dto/cms-response.dto';
import { CmsSectionService } from '../services/cms-section.service';
import { buildCtx } from './cms-controller.util';

@ApiTags('admin-cms-sections')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/sections')
export class CmsSectionController {
  constructor(private readonly service: CmsSectionService) {}

  @Get()
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'List all homepage/feature sections (drafts included)' })
  list(): Promise<CmsSectionDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'Get a section by id' })
  @ApiResponse({ status: 200, type: CmsSectionDto })
  @ApiResponse({ status: 404, description: 'Section not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsSectionDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Create a section (data validated per type)' })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsSectionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsSectionDto> {
    return this.service.create(actor, dto, buildCtx(ip, ua));
  }

  @Patch('reorder')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Reorder sections by sortOrder' })
  reorder(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: ReorderDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsSectionDto[]> {
    return this.service.reorder(actor, dto.orderedIds, buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Update a section (data re-validated per type when supplied)' })
  @ApiResponse({ status: 200, type: CmsSectionDto })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsSectionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsSectionDto> {
    return this.service.update(actor, id, dto, buildCtx(ip, ua));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Soft-delete a section' })
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
  @ApiOperation({ summary: 'Publish a section' })
  @ApiResponse({ status: 200, type: CmsSectionDto })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsSectionDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Unpublish a section' })
  @ApiResponse({ status: 200, type: CmsSectionDto })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsSectionDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
