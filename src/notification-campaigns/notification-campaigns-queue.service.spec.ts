import { Queue } from 'bullmq';
import { NotificationCampaignsQueueService } from './notification-campaigns-queue.service';
import { SEND_CAMPAIGN_JOB } from './notification-campaigns.constants';

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

describe('NotificationCampaignsQueueService', () => {
  let queue: { add: jest.Mock };
  let service: NotificationCampaignsQueueService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationCampaignsQueueService(queue as unknown as Queue);
  });

  it('enqueues an immediate fan-out with a dash-separated deterministic job id', async () => {
    await service.enqueueSend(CAMPAIGN_ID);
    expect(queue.add).toHaveBeenCalledWith(
      SEND_CAMPAIGN_JOB,
      { campaignId: CAMPAIGN_ID },
      expect.objectContaining({ delay: 0, jobId: `${SEND_CAMPAIGN_JOB}-${CAMPAIGN_ID}` }),
    );
  });

  it('passes through a positive delay for a scheduled send', async () => {
    await service.enqueueSend(CAMPAIGN_ID, 60_000);
    expect(queue.add).toHaveBeenCalledWith(
      SEND_CAMPAIGN_JOB,
      { campaignId: CAMPAIGN_ID },
      expect.objectContaining({ delay: 60_000 }),
    );
  });

  it('never uses a colon in the job id (BullMQ rejects it)', async () => {
    await service.enqueueSend(CAMPAIGN_ID);
    const opts = queue.add.mock.calls[0][2] as { jobId: string };
    expect(opts.jobId).not.toContain(':');
  });
});
