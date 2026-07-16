import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { VerificationQueueService } from './verification-queue.service';
import { AUTO_APPROVE_JOB, AUTO_APPROVE_TIMEOUT_HOURS_ENV } from './verification.constants';

const COMPLETION_ID = '33333333-3333-3333-3333-333333333333';
const HOURS_MS = 60 * 60 * 1000;

function build(envValue: string | undefined): {
  service: VerificationQueueService;
  add: jest.Mock;
} {
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = { add } as unknown as Queue;
  const config = {
    get: jest.fn((key: string) => (key === AUTO_APPROVE_TIMEOUT_HOURS_ENV ? envValue : undefined)),
  } as unknown as ConfigService;
  return { service: new VerificationQueueService(queue, config), add };
}

describe('VerificationQueueService', () => {
  it('enqueues the auto-approve job with a delay derived from the configured hours', async () => {
    const { service, add } = build('2');

    await service.enqueueAutoApprove(COMPLETION_ID);

    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = add.mock.calls[0];
    expect(jobName).toBe(AUTO_APPROVE_JOB);
    expect(payload).toEqual({ completionId: COMPLETION_ID });
    expect(opts.delay).toBe(2 * HOURS_MS);
    // '-' not ':' — BullMQ's Job.validateOptions rejects a custom id
    // containing ':', which a real e2e run against live Redis caught (this
    // mocked-queue unit test alone did not, since it never exercises BullMQ's
    // own validation).
    expect(opts.jobId).toBe(`${AUTO_APPROVE_JOB}-${COMPLETION_ID}`);
    // A transient failure (e.g. a brief Postgres blip) must retry with
    // backoff rather than permanently stranding a completion in Pending;
    // failed jobs are kept but bounded so Redis doesn't grow forever.
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    expect(opts.removeOnFail).toEqual({ count: 1_000 });
  });

  it('falls back to the 24h default when the env var is unset', async () => {
    const { service, add } = build(undefined);

    await service.enqueueAutoApprove(COMPLETION_ID);

    expect(add.mock.calls[0][2].delay).toBe(24 * HOURS_MS);
  });

  it('falls back to the default when the env var is non-numeric', async () => {
    const { service, add } = build('not-a-number');

    await service.enqueueAutoApprove(COMPLETION_ID);

    expect(add.mock.calls[0][2].delay).toBe(24 * HOURS_MS);
  });

  it('falls back to the default when the env var is zero or negative (never a 0ms instant approve)', async () => {
    const { service, add } = build('0');

    await service.enqueueAutoApprove(COMPLETION_ID);

    expect(add.mock.calls[0][2].delay).toBe(24 * HOURS_MS);
  });
});
