import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { NotificationCampaignsController } from './notification-campaigns.controller';
import { NotificationCampaignsService } from './notification-campaigns.service';

const ACTOR: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'a@b.co',
  roleId: 'role-1',
  sessionId: 'sess-1',
  mfaPending: false,
  mustChangePassword: false,
};
const IP = '10.0.0.1';
const UA = 'jest-agent';
const ID = '11111111-1111-1111-1111-111111111111';
const EXPECTED_CTX = { actorAdminUserId: 'admin-1', ipAddress: IP, userAgent: UA };

describe('NotificationCampaignsController', () => {
  let controller: NotificationCampaignsController;
  let service: {
    list: jest.Mock;
    getCampaign: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    previewAudience: jest.Mock;
    send: jest.Mock;
    cancel: jest.Mock;
  };

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue('list'),
      getCampaign: jest.fn().mockResolvedValue('detail'),
      create: jest.fn().mockResolvedValue('created'),
      update: jest.fn().mockResolvedValue('updated'),
      remove: jest.fn().mockResolvedValue(undefined),
      previewAudience: jest.fn().mockResolvedValue({ count: 5 }),
      send: jest.fn().mockResolvedValue('sent'),
      cancel: jest.fn().mockResolvedValue('cancelled'),
    };
    controller = new NotificationCampaignsController(
      service as unknown as NotificationCampaignsService,
    );
  });

  it('delegates the list read', async () => {
    await expect(controller.list({})).resolves.toBe('list');
    expect(service.list).toHaveBeenCalledWith({});
  });

  it('delegates the detail read', async () => {
    await expect(controller.get(ID)).resolves.toBe('detail');
    expect(service.getCampaign).toHaveBeenCalledWith(ID);
  });

  it('delegates create with the assembled audit context', async () => {
    const dto = { title: 'T', headline: 'H', body: 'B' };
    await expect(controller.create(ACTOR, dto, IP, UA)).resolves.toBe('created');
    expect(service.create).toHaveBeenCalledWith(dto, EXPECTED_CTX);
  });

  it('delegates update with the assembled audit context', async () => {
    await controller.update(ACTOR, ID, { title: 'X' }, IP, UA);
    expect(service.update).toHaveBeenCalledWith(ID, { title: 'X' }, EXPECTED_CTX);
  });

  it('delegates delete with the assembled audit context', async () => {
    await controller.remove(ACTOR, ID, IP, UA);
    expect(service.remove).toHaveBeenCalledWith(ID, EXPECTED_CTX);
  });

  it('delegates preview-audience (read-only, no context needed)', async () => {
    await expect(controller.previewAudience(ID)).resolves.toEqual({ count: 5 });
    expect(service.previewAudience).toHaveBeenCalledWith(ID);
  });

  it('delegates send with the assembled audit context', async () => {
    await expect(controller.send(ACTOR, ID, IP, UA)).resolves.toBe('sent');
    expect(service.send).toHaveBeenCalledWith(ID, EXPECTED_CTX);
  });

  it('delegates cancel with the assembled audit context', async () => {
    await expect(controller.cancel(ACTOR, ID, IP, UA)).resolves.toBe('cancelled');
    expect(service.cancel).toHaveBeenCalledWith(ID, EXPECTED_CTX);
  });

  it('falls back to a null user agent when the header is absent', async () => {
    await controller.create(ACTOR, { title: 'T', headline: 'H', body: 'B' }, IP);
    expect(service.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userAgent: null }),
    );
  });
});
