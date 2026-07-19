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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  list(): Promise<CmsLinkDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsLinkDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
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
  remove(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<void> {
    return this.service.remove(actor, id, buildCtx(ip, ua));
  }

  @Post(':id/publish')
  @RequirePermission('cms.publish')
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @RequirePermission('cms.publish')
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsLinkDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
