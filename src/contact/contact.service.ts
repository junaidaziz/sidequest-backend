import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContactSubmission, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import {
  ContactSubmissionAckDto,
  ContactSubmissionDto,
  ContactSubmissionPageDto,
} from './dto/contact-submission-response.dto';
import { ListContactSubmissionsQueryDto } from './dto/list-contact-submissions-query.dto';
import { UpdateContactSubmissionDto } from './dto/update-contact-submission.dto';

/** Per-request audit context threaded from the admin controller. */
export interface ContactActionContext {
  actorAdminUserId: string;
  ipAddress: string;
  userAgent: string | null;
}

/**
 * Public contact-form intake + admin triage (closed-beta admin tooling). The
 * public `submit` persists the row and fires a notification email best-effort —
 * a mail failure NEVER fails the submission (mirroring EmailService's swallow-and
 * -log convention and the codebase-wide "a side-effect failure must never fail
 * the primary write" rule). The admin reads/status-update surface is RBAC-gated
 * at the controller.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly notificationEmail: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditLogService,
    config: ConfigService,
  ) {
    this.notificationEmail = config.get<string>('CONTACT_NOTIFICATION_EMAIL');
  }

  /**
   * Persists a public contact submission and sends a best-effort notification
   * email to the configured ops inbox. The email is intentionally NOT awaited in
   * a way that can fail the request: a send failure (or an unset
   * CONTACT_NOTIFICATION_EMAIL) is logged and swallowed.
   */
  async submit(dto: CreateContactSubmissionDto): Promise<ContactSubmissionAckDto> {
    const submission = await this.prisma.contactSubmission.create({
      data: {
        name: dto.name,
        email: dto.email,
        topic: dto.topic,
        message: dto.message,
      },
    });
    this.logger.log(`Contact submission ${submission.id} received`);

    await this.sendNotificationEmail(submission);
    return { success: true, id: submission.id };
  }

  /** Best-effort notification email; isolated so a mail failure never bubbles up. */
  private async sendNotificationEmail(submission: ContactSubmission): Promise<void> {
    if (!this.notificationEmail) {
      this.logger.warn(
        `CONTACT_NOTIFICATION_EMAIL is not set; skipping notification email for submission ${submission.id}`,
      );
      return;
    }
    try {
      // EmailService.send already swallows provider errors and returns an error
      // result; the extra try/catch guards against any unexpected throw so the
      // already-committed submission is never turned into a 500.
      await this.email.sendContactFormNotification(this.notificationEmail, {
        name: submission.name,
        email: submission.email,
        topic: submission.topic,
        message: submission.message,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send contact notification email for submission ${submission.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Paginated, status-filtered admin list, newest first. */
  async list(query: ListContactSubmissionsQueryDto): Promise<ContactSubmissionPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.ContactSubmissionWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contactSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contactSubmission.count({ where }),
    ]);

    return { items: rows.map(ContactSubmissionDto.fromEntity), total, page, pageSize };
  }

  /** Full single-submission view. 404 if not found. */
  async getById(id: string): Promise<ContactSubmissionDto> {
    const row = await this.mustFind(id);
    return ContactSubmissionDto.fromEntity(row);
  }

  /** Updates a submission's triage status. 404 if not found. Audited. */
  async updateStatus(
    id: string,
    dto: UpdateContactSubmissionDto,
    ctx: ContactActionContext,
  ): Promise<ContactSubmissionDto> {
    const existing = await this.mustFind(id);
    const row = await this.prisma.contactSubmission.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.audit.record({
      actorAdminUserId: ctx.actorAdminUserId,
      action: 'contact.status.update',
      targetType: 'ContactSubmission',
      targetId: id,
      previousValue: { status: existing.status },
      newValue: { status: row.status },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      result: AuditResult.Success,
    });
    this.logger.log(`Contact submission ${id} status ${existing.status} -> ${row.status}`);
    return ContactSubmissionDto.fromEntity(row);
  }

  private async mustFind(id: string): Promise<ContactSubmission> {
    const row = await this.prisma.contactSubmission.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Contact submission not found');
    }
    return row;
  }
}
