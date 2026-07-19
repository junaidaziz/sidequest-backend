import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AdminChallengesController } from './admin-challenges.controller';
import { AdminChallengesService } from './admin-challenges.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { ListMissionsQueryDto } from './dto/list-missions-query.dto';
import { AdminMissionDetailDto, AdminMissionPageDto } from './dto/mission-admin-response.dto';

const ACTOR: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'admin@sq.com',
  roleId: 'role-1',
  sessionId: 'sess-1',
  mfaPending: false,
  mustChangePassword: false,
};
const IP = '10.0.0.9';
const UA = 'jest-agent';
const CTX = { actorAdminUserId: 'admin-1', ipAddress: IP, userAgent: UA };

describe('AdminChallengesController', () => {
  let controller: AdminChallengesController;
  let service: {
    list: jest.Mock;
    getById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    publish: jest.Mock;
    unpublish: jest.Mock;
    archive: jest.Mock;
    setFeatured: jest.Mock;
    duplicate: jest.Mock;
    remove: jest.Mock;
  };

  const detail = { id: 'mission-1' } as AdminMissionDetailDto;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue(detail),
      getById: jest.fn().mockResolvedValue(detail),
      create: jest.fn().mockResolvedValue(detail),
      update: jest.fn().mockResolvedValue(detail),
      publish: jest.fn().mockResolvedValue(detail),
      unpublish: jest.fn().mockResolvedValue(detail),
      archive: jest.fn().mockResolvedValue(detail),
      setFeatured: jest.fn().mockResolvedValue(detail),
      duplicate: jest.fn().mockResolvedValue(detail),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AdminChallengesController(service as unknown as AdminChallengesService);
  });

  it('list delegates the query', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 } as AdminMissionPageDto;
    service.list.mockResolvedValue(page);
    const query = { status: undefined } as ListMissionsQueryDto;
    await expect(controller.list(query)).resolves.toBe(page);
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('getById delegates the id', async () => {
    await expect(controller.getById('mission-1')).resolves.toBe(detail);
    expect(service.getById).toHaveBeenCalledWith('mission-1');
  });

  it('create forwards dto + assembled context', async () => {
    const dto = { title: 'X' } as CreateMissionDto;
    await controller.create(ACTOR, dto, IP, UA);
    expect(service.create).toHaveBeenCalledWith(dto, CTX);
  });

  it('update forwards id + dto + context', async () => {
    await controller.update(ACTOR, 'mission-1', { title: 'Y' }, IP, UA);
    expect(service.update).toHaveBeenCalledWith('mission-1', { title: 'Y' }, CTX);
  });

  it('publish forwards id + context + reason', async () => {
    await controller.publish(ACTOR, 'mission-1', { reason: 'go' }, IP, UA);
    expect(service.publish).toHaveBeenCalledWith('mission-1', CTX, 'go');
  });

  it('publish defaults a missing reason to null', async () => {
    await controller.publish(ACTOR, 'mission-1', {}, IP, UA);
    expect(service.publish).toHaveBeenCalledWith('mission-1', CTX, null);
  });

  it('unpublish forwards id + context + reason', async () => {
    await controller.unpublish(ACTOR, 'mission-1', { reason: 'oops' }, IP, UA);
    expect(service.unpublish).toHaveBeenCalledWith('mission-1', CTX, 'oops');
  });

  it('archive forwards id + context + reason', async () => {
    await controller.archive(ACTOR, 'mission-1', {}, IP, UA);
    expect(service.archive).toHaveBeenCalledWith('mission-1', CTX, null);
  });

  it('feature calls setFeatured(true)', async () => {
    await controller.feature(ACTOR, 'mission-1', {}, IP, UA);
    expect(service.setFeatured).toHaveBeenCalledWith('mission-1', true, CTX, null);
  });

  it('unfeature calls setFeatured(false)', async () => {
    await controller.unfeature(ACTOR, 'mission-1', {}, IP, UA);
    expect(service.setFeatured).toHaveBeenCalledWith('mission-1', false, CTX, null);
  });

  it('duplicate forwards id + context + reason', async () => {
    await controller.duplicate(ACTOR, 'mission-1', { reason: 'variant' }, IP, UA);
    expect(service.duplicate).toHaveBeenCalledWith('mission-1', CTX, 'variant');
  });

  it('remove forwards id + context + reason and resolves void', async () => {
    const result = await controller.remove(ACTOR, 'mission-1', { reason: 'retire' }, IP, UA);
    expect(service.remove).toHaveBeenCalledWith('mission-1', CTX, 'retire');
    expect(result).toBeUndefined();
  });

  it('defaults a missing user-agent header to null in the context', async () => {
    await controller.getById('mission-1');
    await controller.create(ACTOR, { title: 'X' } as CreateMissionDto, IP);
    expect(service.create).toHaveBeenCalledWith(
      { title: 'X' },
      { actorAdminUserId: 'admin-1', ipAddress: IP, userAgent: null },
    );
  });
});
