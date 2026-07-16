import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { NotificationsQueueService } from './notifications-queue.service';
import {
  CHECK_RECEIPTS_JOB,
  RECEIPT_CHECK_DELAY_MINUTES_ENV,
  SEND_PUSH_JOB,
} from './notifications.constants';

const NOTIFICATION_ID = '55555555-5555-5555-5555-555555555555';
const MINUTE_MS = 60 * 1000;

function build(envValue: string | undefined): {
  service: NotificationsQueueService;
  add: jest.Mock;
} {
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = { add } as unknown as Queue;
  const config = {
    get: jest.fn((key: string) => (key === RECEIPT_CHECK_DELAY_MINUTES_ENV ? envValue : undefined)),
  } as unknown as ConfigService;
  return { service: new NotificationsQueueService(queue, config), add };
}

describe('NotificationsQueueService', () => {
  describe('enqueuePushDelivery', () => {
    it('enqueues an immediate send-push job keyed by notification id', async () => {
      const { service, add } = build(undefined);

      await service.enqueuePushDelivery(NOTIFICATION_ID);

      expect(add).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = add.mock.calls[0];
      expect(jobName).toBe(SEND_PUSH_JOB);
      expect(payload).toEqual({ notificationId: NOTIFICATION_ID });
      // '-' not ':' — BullMQ rejects a custom id containing ':'.
      expect(opts.jobId).toBe(`${SEND_PUSH_JOB}-${NOTIFICATION_ID}`);
      expect(opts.jobId).not.toContain(':');
      expect(opts.delay).toBeUndefined();
      expect(opts.attempts).toBe(3);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 5_000 });
      expect(opts.removeOnFail).toEqual({ count: 1_000 });
    });
  });

  describe('enqueueReceiptCheck', () => {
    it('does nothing when there are no receipt ids', async () => {
      const { service, add } = build(undefined);

      await service.enqueueReceiptCheck([], {});

      expect(add).not.toHaveBeenCalled();
    });

    it('schedules a delayed receipt-check with the configured minutes', async () => {
      const { service, add } = build('30');

      await service.enqueueReceiptCheck(['r-1'], { 'r-1': 'tok' });

      const [jobName, payload, opts] = add.mock.calls[0];
      expect(jobName).toBe(CHECK_RECEIPTS_JOB);
      expect(payload).toEqual({ receiptIds: ['r-1'], tokenByReceiptId: { 'r-1': 'tok' } });
      expect(opts.delay).toBe(30 * MINUTE_MS);
      expect(opts.jobId).toContain(CHECK_RECEIPTS_JOB);
      expect(opts.jobId).not.toContain(':');
      expect(opts.attempts).toBe(3);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 5_000 });
      expect(opts.removeOnFail).toEqual({ count: 1_000 });
    });

    it('falls back to the 15-minute default when the env var is unset', async () => {
      const { service, add } = build(undefined);

      await service.enqueueReceiptCheck(['r-1'], { 'r-1': 'tok' });

      expect(add.mock.calls[0][2].delay).toBe(15 * MINUTE_MS);
    });

    it('falls back to the default when the env var is non-numeric', async () => {
      const { service, add } = build('soon');

      await service.enqueueReceiptCheck(['r-1'], { 'r-1': 'tok' });

      expect(add.mock.calls[0][2].delay).toBe(15 * MINUTE_MS);
    });

    it('falls back to the default when the env var is zero or negative', async () => {
      const { service, add } = build('0');

      await service.enqueueReceiptCheck(['r-1'], { 'r-1': 'tok' });

      expect(add.mock.calls[0][2].delay).toBe(15 * MINUTE_MS);
    });
  });
});
