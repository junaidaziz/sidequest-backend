import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationDto, PaginatedNotificationsDto } from './dto/notification-response.dto';
import { MarkReadResultDto, UnreadCountDto } from './dto/unread-count.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { DeregisterPushTokenResultDto, PushTokenDto } from './dto/push-token-response.dto';
import {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Declared before `:id`-style routes so the static segments win path matching.

  @Get()
  @ApiOperation({ summary: "Paginated, newest-first list of the caller's in-app notifications." })
  @ApiResponse({ status: 200, type: PaginatedNotificationsDto })
  @ApiResponse({ status: 400, description: 'Invalid pagination parameters' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsDto> {
    return this.notificationsService.list(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge count for the caller.' })
  @ApiResponse({ status: 200, type: UnreadCountDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getUnreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return this.notificationsService.getUnreadCount(user.userId);
  }

  @Get('preferences')
  @ApiOperation({ summary: "Read the caller's notification preferences." })
  @ApiResponse({ status: 200, type: NotificationPreferencesDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getPreferences(@CurrentUser() user: AuthUser): Promise<NotificationPreferencesDto> {
    return this.notificationsService.getPreferences(user.userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: "Partially update the caller's notification preferences." })
  @ApiResponse({ status: 200, type: NotificationPreferencesDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return this.notificationsService.updatePreferences(user.userId, dto);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark all of the caller's unread notifications read." })
  @ApiResponse({ status: 200, type: MarkReadResultDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  markAllRead(@CurrentUser() user: AuthUser): Promise<MarkReadResultDto> {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Post('push-tokens')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register/upsert a device push token (idempotent per device).' })
  @ApiResponse({ status: 201, type: PushTokenDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  registerPushToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<PushTokenDto> {
    return this.notificationsService.registerPushToken(user.userId, dto);
  }

  @Delete('push-tokens/:token')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'token', description: 'The device push token to deregister.' })
  @ApiOperation({
    summary: 'Deregister a device push token (also wired into POST /auth/logout).',
  })
  @ApiResponse({ status: 200, type: DeregisterPushTokenResultDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  deregisterPushToken(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ): Promise<DeregisterPushTokenResultDto> {
    return this.notificationsService.deregisterPushToken(user.userId, token);
  }

  @Patch(':id/read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: "Mark one notification read (caller's own only)." })
  @ApiResponse({ status: 200, type: NotificationDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDto> {
    return this.notificationsService.markRead(user.userId, id);
  }
}
