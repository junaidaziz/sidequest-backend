import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

describe('AuditLogController', () => {
  it('delegates the query to the service', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
    };
    const controller = new AuditLogController(service as unknown as AuditLogService);
    const query = { page: 1, pageSize: 25 };
    const result = await controller.list(query);
    expect(service.list).toHaveBeenCalledWith(query);
    expect(result.total).toBe(0);
  });
});
