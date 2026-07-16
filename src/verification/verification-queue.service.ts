import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AUTO_APPROVE_JOB,
  AUTO_APPROVE_TIMEOUT_HOURS_ENV,
  AutoApproveJobData,
  DEFAULT_AUTO_APPROVE_TIMEOUT_HOURS,
  VERIFICATION_QUEUE,
} from './verification.constants';

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Thin producer wrapper around the verification queue. Keeps the delay/config
 * math and the BullMQ `add` options in one testable place so ProofService only
 * has to say "schedule this completion for auto-approval" without knowing about
 * queue mechanics.
 */
@Injectable()
export class VerificationQueueService {
  private readonly logger = new Logger(VerificationQueueService.name);

  constructor(
    @InjectQueue(VERIFICATION_QUEUE) private readonly queue: Queue<AutoApproveJobData>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Timeout window in milliseconds, derived from
   * PROOF_AUTO_APPROVE_TIMEOUT_HOURS. Falls back to the 24h default when the env
   * var is unset or not a positive finite number (mirrors app.module's
   * NaN-guarding of throttle env vars — a bad value must not silently schedule a
   * zero-delay job that approves proofs instantly).
   */
  private resolveDelayMs(): number {
    const raw = Number(this.config.get<string>(AUTO_APPROVE_TIMEOUT_HOURS_ENV));
    const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUTO_APPROVE_TIMEOUT_HOURS;
    return hours * MS_PER_HOUR;
  }

  /**
   * Schedules the delayed auto-approval for a freshly-created completion. Uses
   * the completion id as the BullMQ job id so a retried submission path can
   * never enqueue two timers for the same completion.
   */
  async enqueueAutoApprove(completionId: string): Promise<void> {
    const delay = this.resolveDelayMs();
    await this.queue.add(
      AUTO_APPROVE_JOB,
      { completionId },
      {
        delay,
        // BullMQ rejects ':' in custom job ids (Job.validateOptions throws
        // "Custom Id cannot contain :") — confirmed by a real e2e failure,
        // not a hypothetical. '-' is safe and keeps the id human-readable.
        jobId: `${AUTO_APPROVE_JOB}-${completionId}`,
        removeOnComplete: true,
        // A transient failure (e.g. a brief Postgres blip) must not
        // permanently strand a completion in Pending — retry with backoff
        // before giving up. Failed jobs are still kept (not
        // removeOnFail: true) for operator visibility, but bounded so Redis
        // doesn't accumulate them forever.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnFail: { count: 1_000 },
      },
    );
    this.logger.log(`Scheduled auto-approval for completion ${completionId} in ${delay}ms`);
  }
}
