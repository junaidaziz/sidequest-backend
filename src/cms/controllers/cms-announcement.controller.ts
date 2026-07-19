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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../../rbac/guards/permission.guard';
import { CreateCmsAnnouncementDto, UpdateCmsAnnouncementDto } from '../dto/cms-content.dto';
import { CmsAnnouncementDto } from '../dto/cms-response.dto';
import { CmsAnnouncementService } from '../services/cms-announcement.service';
import { buildCtx, CMS_IMAGE_UPLOAD_OPTIONS, requireFile } from './cms-controller.util';

@ApiTags('admin-cms-announcements')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/announcements')
export class CmsAnnouncementController {
  constructor(private readonly service: CmsAnnouncementService) {}

  @Get()
  @RequirePermission('cms.view')
  list(): Promise<CmsAnnouncementDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsAnnouncementDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsAnnouncementDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsAnnouncementDto> {
    return this.service.create(actor, dto, buildCtx(ip, ua));
  }

  @Post(':id/cover')
  @RequirePermission('cms.edit')
  @UseInterceptors(FileInterceptor('file', CMS_IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload/replace the cover image (SVG sanitized server-side)' })
  setCover(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsAnnouncementDto> {
    return this.service.setCover(actor, id, requireFile(file), buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsAnnouncementDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsAnnouncementDto> {
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
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Publish an announcement' })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsAnnouncementDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Unpublish an announcement' })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsAnnouncementDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
