import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsQueueService } from './notifications-queue.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationDto, PaginatedNotificationsDto } from './dto/notification-response.dto';
import { MarkReadResultDto, UnreadCountDto } from './dto/unread-count.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { DeregisterPushTokenResultDto, PushTokenDto } from './dto/push-token-response.dto';
import {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto';

const DEFAULT_LIST_LIMIT = 20;

/**
 * Defaults applied when a user has no NotificationPreference row yet — absence
 * means "all enabled", so a user who never opened Settings still gets
 * notifications. The processor uses the same defaults on its side.
 */
export const DEFAULT_PREFERENCES: NotificationPreferencesDto = {
  pushEnabled: true,
  taskEventsEnabled: true,
  referralEventsEnabled: true,
  accountEventsEnabled: true,
};

/** Arguments for the {@link NotificationsService.notify} producer. */
export interface NotifyParams {
  /** Recipient user id. */
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link routing payload persisted on the row and forwarded to push. */
  data?: Record<string, unknown>;
}

/**
 * Notifications (M21). Owns the in-app notification store (list, unread count,
 * mark-read), device push-token registration, per-user preferences, and the
 * `notify()` producer that other domains (TasksService M19, ReferralsService
 * M20, AuthService account events) call at their event points. `notify()`
 * always writes the in-app row synchronously and enqueues push delivery
 * best-effort — the actual send happens off the request path in
 * NotificationsProcessor. Depends only on Prisma and the queue producer, so
 * consumers import this one-directionally with no dependency cycle.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationsQueueService,
  ) {}

  // --------------------------------------------------------------------------
  // M21.2 — In-app CRUD
  // --------------------------------------------------------------------------

  async list(userId: string, query: ListNotificationsQueryDto): Promise<PaginatedNotificationsDto> {
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const offset = query.offset ?? 0;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items: rows.map((row) => this.mapNotification(row)), total, limit, offset };
  }

  async getUnreadCount(userId: string): Promise<UnreadCountDto> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unreadCount };
  }

  /** Marks one notification read. Scoped to the caller — 404 if not theirs. */
  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.readAt) {
      // Already read — idempotent, return as-is without a redundant write.
      return this.mapNotification(notification);
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return this.mapNotification(updated);
  }

  /** Marks every unread notification for the caller read. */
  async markAllRead(userId: string): Promise<MarkReadResultDto> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.logger.log(`Marked ${result.count} notification(s) read for user ${userId}`);
    return { updated: result.count };
  }

  // --------------------------------------------------------------------------
  // M21.3 — Push-token registration / deregistration
  // --------------------------------------------------------------------------

  /**
   * Registers (or refreshes) a device push token. Upserts on (userId, token) so
   * re-logging-in from the same device never duplicates a row (M21.3
   * acceptance); a re-register also clears `disabledAt`, reviving a token the
   * provider had previously reported dead but which the client now proves live.
   */
  async registerPushToken(userId: string, dto: RegisterPushTokenDto): Promise<PushTokenDto> {
    const row = await this.prisma.pushToken.upsert({
      where: { userId_token: { userId, token: dto.token } },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
        deviceId: dto.deviceId ?? null,
      },
      update: {
        platform: dto.platform,
        deviceId: dto.deviceId ?? null,
        disabledAt: null,
      },
    });
    this.logger.log(`Push token registered for user ${userId} (${dto.platform})`);
    return this.mapPushToken(row);
  }

  /**
   * Removes a device's push token. Idempotent (deleting a missing token
   * succeeds with removed=0), so it is safe to call from logout without a prior
   * existence check. Scoped to the caller — a token can only be removed by the
   * user it belongs to.
   */
  async deregisterPushToken(userId: string, token: string): Promise<DeregisterPushTokenResultDto> {
    const result = await this.prisma.pushToken.deleteMany({ where: { userId, token } });
    this.logger.log(`Push token deregistered for user ${userId} (removed ${result.count})`);
    return { success: true, removed: result.count };
  }

  // --------------------------------------------------------------------------
  // M21 — Preferences (read/update; surfaced in M22 Settings)
  // --------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<NotificationPreferencesDto> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    // A GET never writes — absence is reported as the all-enabled default and
    // only persisted the first time the user actually changes something.
    return row ? this.mapPreferences(row) : { ...DEFAULT_PREFERENCES };
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const patch = {
      ...(dto.pushEnabled !== undefined ? { pushEnabled: dto.pushEnabled } : {}),
      ...(dto.taskEventsEnabled !== undefined ? { taskEventsEnabled: dto.taskEventsEnabled } : {}),
      ...(dto.referralEventsEnabled !== undefined
        ? { referralEventsEnabled: dto.referralEventsEnabled }
        : {}),
      ...(dto.accountEventsEnabled !== undefined
        ? { accountEventsEnabled: dto.accountEventsEnabled }
        : {}),
    };
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });
    this.logger.log(`Notification preferences updated for user ${userId}`);
    return this.mapPreferences(row);
  }

  // --------------------------------------------------------------------------
  // Producer — called by TasksService / ReferralsService / AuthService
  // --------------------------------------------------------------------------

  /**
   * Creates the in-app notification row synchronously, then enqueues push
   * delivery best-effort. A queue failure is logged and swallowed — the in-app
   * notification is the source of truth and must never be lost to a transient
   * Redis hiccup (same try/catch-and-log idiom
   * VerificationQueueService.enqueueAutoApprove uses).
   *
   * Callers additionally wrap this whole call in their own try/catch (the
   * notification-hook isolation pattern), so even the row write here can never
   * break the primary operation the notification is attached to.
   */
  async notify(params: NotifyParams): Promise<void> {
    const { userId, type, title, body, data } = params;
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data === undefined ? Prisma.JsonNull : (data as Prisma.InputJsonValue),
      },
    });
    try {
      await this.queue.enqueuePushDelivery(notification.id);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue push delivery for notification ${notification.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Mappers
  // --------------------------------------------------------------------------

  private mapNotification(row: Notification): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: (row.data as Record<string, unknown> | null) ?? null,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }

  private mapPushToken(row: {
    id: string;
    token: string;
    platform: string;
    deviceId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PushTokenDto {
    return {
      id: row.id,
      token: row.token,
      platform: row.platform as PushTokenDto['platform'],
      deviceId: row.deviceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapPreferences(row: {
    pushEnabled: boolean;
    taskEventsEnabled: boolean;
    referralEventsEnabled: boolean;
    accountEventsEnabled: boolean;
  }): NotificationPreferencesDto {
    return {
      pushEnabled: row.pushEnabled,
      taskEventsEnabled: row.taskEventsEnabled,
      referralEventsEnabled: row.referralEventsEnabled,
      accountEventsEnabled: row.accountEventsEnabled,
    };
  }
}
