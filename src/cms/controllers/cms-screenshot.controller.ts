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
import { ReorderDto } from '../dto/common.dto';
import { CreateCmsScreenshotDto, UpdateCmsScreenshotDto } from '../dto/cms-content.dto';
import { CmsScreenshotDto } from '../dto/cms-response.dto';
import { CmsScreenshotService } from '../services/cms-screenshot.service';
import { buildCtx, CMS_IMAGE_UPLOAD_OPTIONS, requireFile } from './cms-controller.util';

@ApiTags('admin-cms-screenshots')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/screenshots')
export class CmsScreenshotController {
  constructor(private readonly service: CmsScreenshotService) {}

  @Get()
  @RequirePermission('cms.view')
  list(): Promise<CmsScreenshotDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsScreenshotDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  @UseInterceptors(FileInterceptor('file', CMS_IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a screenshot from an uploaded image + metadata' })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsScreenshotDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsScreenshotDto> {
    return this.service.createWithImage(actor, dto, requireFile(file), buildCtx(ip, ua));
  }

  @Patch('reorder')
  @RequirePermission('cms.edit')
  reorder(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: ReorderDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsScreenshotDto[]> {
    return this.service.reorder(actor, dto.orderedIds, buildCtx(ip, ua));
  }

  @Post(':id/image')
  @RequirePermission('cms.edit')
  @UseInterceptors(FileInterceptor('file', CMS_IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Replace the screenshot image (SVG sanitized server-side)' })
  replaceImage(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsScreenshotDto> {
    return this.service.replaceImage(actor, id, requireFile(file), buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsScreenshotDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsScreenshotDto> {
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
  @ApiOperation({ summary: 'Publish a screenshot' })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsScreenshotDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Unpublish a screenshot' })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsScreenshotDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
