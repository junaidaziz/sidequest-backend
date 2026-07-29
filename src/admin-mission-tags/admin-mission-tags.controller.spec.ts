import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AdminMissionTagsController } from './admin-mission-tags.controller';
import { AdminMissionTagsService } from './admin-mission-tags.service';

const ADMIN = { adminUserId: 'admin-1' } as AuthAdmin;
const TAG = {
  id: 'tag-1',
  type: 'Crew',
  value: 'Solo',
  label: 'Solo',
  isActive: true,
  sortOrder: 0,
};

describe('AdminMissionTagsController', () => {
  let service: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deactivate: jest.Mock;
  };
  let controller: AdminMissionTagsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [TAG], total: 1 }),
      create: jest.fn().mockResolvedValue(TAG),
      update: jest.fn().mockResolvedValue(TAG),
      deactivate: jest.fn().mockResolvedValue({ ...TAG, isActive: false }),
    };
    controller = new AdminMissionTagsController(service as unknown as AdminMissionTagsService);
  });

  it('GET delegates to list', async () => {
    const result = await controller.list({ type: 'Crew' });
    expect(service.list).toHaveBeenCalledWith({ type: 'Crew' });
    expect(result.total).toBe(1);
  });

  it('POST forwards the DTO and an assembled action context', async () => {
    const dto = { type: 'Crew' as const, value: 'Solo', label: 'Solo' };
    await controller.create(ADMIN, dto, '1.2.3.4', 'ua');
    expect(service.create).toHaveBeenCalledWith(dto, {
      actorAdminUserId: 'admin-1',
      ipAddress: '1.2.3.4',
      userAgent: 'ua',
    });
  });

  it('PATCH forwards id + DTO', async () => {
    await controller.update(ADMIN, 'tag-1', { label: 'New' }, '1.2.3.4');
    expect(service.update).toHaveBeenCalledWith(
      'tag-1',
      { label: 'New' },
      expect.objectContaining({ actorAdminUserId: 'admin-1', userAgent: null }),
    );
  });

  it('DELETE delegates to deactivate (never a hard delete)', async () => {
    const result = await controller.deactivate(ADMIN, 'tag-1', '1.2.3.4', 'ua');
    expect(service.deactivate).toHaveBeenCalledWith(
      'tag-1',
      expect.objectContaining({ actorAdminUserId: 'admin-1' }),
    );
    expect(result.isActive).toBe(false);
  });
});
