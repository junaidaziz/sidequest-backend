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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../../rbac/guards/permission.guard';
import { CreateCmsPageDto, UpdateCmsPageDto } from '../dto/cms-content.dto';
import { CmsPageDto } from '../dto/cms-response.dto';
import { CmsPageService } from '../services/cms-page.service';
import { buildCtx } from './cms-controller.util';

@ApiTags('admin-cms-pages')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/pages')
export class CmsPageController {
  constructor(private readonly service: CmsPageService) {}

  @Get()
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'List all pages (drafts included)' })
  list(): Promise<CmsPageDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'Get a page by id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsPageDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Create a page (starts as Draft)' })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsPageDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsPageDto> {
    return this.service.create(actor, dto, buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Update a page' })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsPageDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsPageDto> {
    return this.service.update(actor, id, dto, buildCtx(ip, ua));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Soft-delete a page' })
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
  @ApiOperation({ summary: 'Publish a page' })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsPageDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Unpublish a page' })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsPageDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
