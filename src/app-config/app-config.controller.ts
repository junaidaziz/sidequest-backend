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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { buildCtx } from '../cms/controllers/cms-controller.util';
import { AppConfigService } from './app-config.service';
import { AppConfigDto, UpsertAppConfigDto } from './dto/app-config.dto';

@ApiTags('admin-app-config')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/config')
export class AppConfigController {
  constructor(private readonly service: AppConfigService) {}

  @Get()
  @RequirePermission('app_config.view')
  @ApiOperation({ summary: 'List all application config entries' })
  @ApiResponse({ status: 200, type: [AppConfigDto] })
  list(): Promise<AppConfigDto[]> {
    return this.service.list();
  }

  @Get(':key')
  @RequirePermission('app_config.view')
  @ApiOperation({ summary: 'Get a single config entry by key' })
  get(@Param('key') key: string): Promise<AppConfigDto> {
    return this.service.get(key);
  }

  @Put(':key')
  @RequirePermission('app_config.manage')
  @ApiOperation({ summary: 'Create or update a config key' })
  upsert(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('key') key: string,
    @Body() dto: UpsertAppConfigDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AppConfigDto> {
    return this.service.upsert(actor, key, dto, buildCtx(ip, ua));
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('app_config.manage')
  @ApiOperation({ summary: 'Soft-delete a config key' })
  remove(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('key') key: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<void> {
    return this.service.remove(actor, key, buildCtx(ip, ua));
  }
}
