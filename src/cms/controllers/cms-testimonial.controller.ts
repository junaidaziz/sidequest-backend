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
import { CreateCmsTestimonialDto, UpdateCmsTestimonialDto } from '../dto/cms-content.dto';
import { CmsTestimonialDto } from '../dto/cms-response.dto';
import { CmsTestimonialService } from '../services/cms-testimonial.service';
import { buildCtx, CMS_IMAGE_UPLOAD_OPTIONS, requireFile } from './cms-controller.util';

@ApiTags('admin-cms-testimonials')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/testimonials')
export class CmsTestimonialController {
  constructor(private readonly service: CmsTestimonialService) {}

  @Get()
  @RequirePermission('cms.view')
  list(): Promise<CmsTestimonialDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsTestimonialDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsTestimonialDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsTestimonialDto> {
    return this.service.create(actor, dto, buildCtx(ip, ua));
  }

  @Patch('reorder')
  @RequirePermission('cms.edit')
  reorder(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: ReorderDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsTestimonialDto[]> {
    return this.service.reorder(actor, dto.orderedIds, buildCtx(ip, ua));
  }

  @Post(':id/avatar')
  @RequirePermission('cms.edit')
  @UseInterceptors(FileInterceptor('file', CMS_IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload/replace an avatar image (SVG sanitized server-side)' })
  setAvatar(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsTestimonialDto> {
    return this.service.setAvatar(actor, id, requireFile(file), buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsTestimonialDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsTestimonialDto> {
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
  ): Promise<CmsTestimonialDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @RequirePermission('cms.publish')
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsTestimonialDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
