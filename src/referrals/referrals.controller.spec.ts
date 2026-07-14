import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { AuthUser } from '../auth/types/jwt-payload.interface';

const USER: AuthUser = { userId: 'user-1', email: 'user@example.com', isGuest: false };

describe('ReferralsController', () => {
  let controller: ReferralsController;
  let service: {
    getMe: jest.Mock;
    recordInvite: jest.Mock;
    getHistory: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getMe: jest.fn(),
      recordInvite: jest.fn(),
      getHistory: jest.fn(),
    };
    controller = new ReferralsController(service as unknown as ReferralsService);
  });

  describe('getMe', () => {
    it("delegates to the service with the caller's id", async () => {
      const dto = { code: 'ABC12345', inviteUrl: 'x' };
      service.getMe.mockResolvedValue(dto);

      await expect(controller.getMe(USER)).resolves.toBe(dto);
      expect(service.getMe).toHaveBeenCalledWith('user-1');
    });
  });

  describe('recordInvite', () => {
    it('forwards the channel body and idempotency key', async () => {
      const dto = { success: true, channel: 'whatsapp' as const, totalInvitesSent: 1 };
      service.recordInvite.mockResolvedValue(dto);

      await expect(
        controller.recordInvite(USER, { channel: 'whatsapp' }, 'idem-key'),
      ).resolves.toBe(dto);
      expect(service.recordInvite).toHaveBeenCalledWith(
        'user-1',
        { channel: 'whatsapp' },
        'idem-key',
      );
    });

    it('forwards an undefined idempotency key unchanged', async () => {
      service.recordInvite.mockResolvedValue({});

      await controller.recordInvite(USER, { channel: 'copy_link' }, undefined);

      expect(service.recordInvite).toHaveBeenCalledWith(
        'user-1',
        { channel: 'copy_link' },
        undefined,
      );
    });
  });

  describe('getHistory', () => {
    it('forwards pagination query to the service', async () => {
      const page = { items: [], total: 0, limit: 20, offset: 0 };
      service.getHistory.mockResolvedValue(page);

      await expect(controller.getHistory(USER, { limit: 20, offset: 0 })).resolves.toBe(page);
      expect(service.getHistory).toHaveBeenCalledWith('user-1', { limit: 20, offset: 0 });
    });
  });
});
