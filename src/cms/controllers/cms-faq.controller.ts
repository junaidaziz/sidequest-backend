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
import { CreateCmsFaqDto, UpdateCmsFaqDto } from '../dto/cms-content.dto';
import { CmsFaqDto } from '../dto/cms-response.dto';
import { CmsFaqService } from '../services/cms-faq.service';
import { buildCtx } from './cms-controller.util';

@ApiTags('admin-cms-faqs')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/cms/faqs')
export class CmsFaqController {
  constructor(private readonly service: CmsFaqService) {}

  @Get()
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'List all FAQs (drafts included)' })
  @ApiResponse({ status: 200, type: [CmsFaqDto] })
  list(): Promise<CmsFaqDto[]> {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('cms.view')
  @ApiOperation({ summary: 'Get a FAQ by id' })
  @ApiResponse({ status: 200, type: CmsFaqDto })
  @ApiResponse({ status: 404, description: 'FAQ not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CmsFaqDto> {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Create a FAQ (starts as Draft)' })
  @ApiResponse({ status: 201, type: CmsFaqDto })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCmsFaqDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsFaqDto> {
    return this.service.create(actor, dto, buildCtx(ip, ua));
  }

  @Patch('reorder')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Reorder FAQs by sortOrder' })
  @ApiResponse({ status: 200, type: [CmsFaqDto] })
  reorder(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: ReorderDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsFaqDto[]> {
    return this.service.reorder(actor, dto.orderedIds, buildCtx(ip, ua));
  }

  @Patch(':id')
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Update a FAQ' })
  @ApiResponse({ status: 200, type: CmsFaqDto })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsFaqDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsFaqDto> {
    return this.service.update(actor, id, dto, buildCtx(ip, ua));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('cms.edit')
  @ApiOperation({ summary: 'Soft-delete a FAQ' })
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
  @ApiOperation({ summary: 'Publish a FAQ' })
  @ApiResponse({ status: 200, type: CmsFaqDto })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsFaqDto> {
    return this.service.setPublished(actor, id, true, buildCtx(ip, ua));
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cms.publish')
  @ApiOperation({ summary: 'Unpublish a FAQ' })
  @ApiResponse({ status: 200, type: CmsFaqDto })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CmsFaqDto> {
    return this.service.setPublished(actor, id, false, buildCtx(ip, ua));
  }
}
