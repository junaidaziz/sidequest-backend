import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AdminContactController } from './admin-contact.controller';
import { ContactService } from './contact.service';

const ADMIN = { adminUserId: 'admin-1' } as AuthAdmin;
const SUBMISSION = {
  id: 'sub-1',
  name: 'Ada',
  email: 'ada@example.com',
  topic: 'Hi',
  message: 'Hello',
  status: 'New' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AdminContactController', () => {
  let service: { list: jest.Mock; getById: jest.Mock; updateStatus: jest.Mock };
  let controller: AdminContactController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [SUBMISSION], total: 1, page: 1, pageSize: 25 }),
      getById: jest.fn().mockResolvedValue(SUBMISSION),
      updateStatus: jest.fn().mockResolvedValue({ ...SUBMISSION, status: 'Resolved' }),
    };
    controller = new AdminContactController(service as unknown as ContactService);
  });

  it('GET list forwards the query', async () => {
    const result = await controller.list({ status: 'New' });
    expect(service.list).toHaveBeenCalledWith({ status: 'New' });
    expect(result.total).toBe(1);
  });

  it('GET :id forwards the id', async () => {
    await controller.getById('sub-1');
    expect(service.getById).toHaveBeenCalledWith('sub-1');
  });

  it('PATCH :id forwards id, DTO, and an assembled action context', async () => {
    const result = await controller.updateStatus(
      ADMIN,
      'sub-1',
      { status: 'Resolved' },
      '1.2.3.4',
      'ua',
    );
    expect(service.updateStatus).toHaveBeenCalledWith(
      'sub-1',
      { status: 'Resolved' },
      { actorAdminUserId: 'admin-1', ipAddress: '1.2.3.4', userAgent: 'ua' },
    );
    expect(result.status).toBe('Resolved');
  });

  it('defaults userAgent to null when the header is absent', async () => {
    await controller.updateStatus(ADMIN, 'sub-1', { status: 'Read' }, '1.2.3.4');
    expect(service.updateStatus).toHaveBeenCalledWith(
      'sub-1',
      { status: 'Read' },
      expect.objectContaining({ userAgent: null }),
    );
  });
});
