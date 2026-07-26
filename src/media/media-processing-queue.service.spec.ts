import { Queue } from 'bullmq';
import { MediaProcessingQueueService } from './media-processing-queue.service';
import { GENERATE_VARIANTS_JOB, MEDIA_PROCESSING_MAX_ATTEMPTS } from './media.constants';

function build(): { service: MediaProcessingQueueService; add: jest.Mock } {
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = { add } as unknown as Queue;
  return { service: new MediaProcessingQueueService(queue), add };
}

describe('MediaProcessingQueueService', () => {
  it('enqueues a generate-variants job keyed by the media asset id', async () => {
    const { service, add } = build();

    await service.enqueueGenerateVariants('media-1');

    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = add.mock.calls[0];
    expect(jobName).toBe(GENERATE_VARIANTS_JOB);
    expect(payload).toEqual({ mediaAssetId: 'media-1' });
    // The job id IS the media asset id (not a composite string) — a single
    // asset only ever needs one variant-generation job in flight, so
    // BullMQ's own dedupe-by-id is the idempotency guard for a duplicate
    // confirmUpload call.
    expect(opts.jobId).toBe('media-1');
    expect(opts.attempts).toBe(MEDIA_PROCESSING_MAX_ATTEMPTS);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toEqual({ count: 1_000 });
  });
});
