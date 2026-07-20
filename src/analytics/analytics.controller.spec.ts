import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../rbac/decorators/require-permission.decorator';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: { getOverview: jest.Mock; exportCsv: jest.Mock };

  beforeEach(() => {
    service = {
      getOverview: jest.fn().mockResolvedValue('overview'),
      exportCsv: jest.fn().mockResolvedValue('metric,value\n'),
    };
    controller = new AnalyticsController(service as unknown as AnalyticsService);
  });

  it('delegates the overview read with the range query', async () => {
    const query = { from: '2026-07-01T00:00:00.000Z' };
    await expect(controller.getOverview(query)).resolves.toBe('overview');
    expect(service.getOverview).toHaveBeenCalledWith(query);
  });

  it('delegates the CSV export with the range query', async () => {
    await expect(controller.exportCsv({})).resolves.toBe('metric,value\n');
    expect(service.exportCsv).toHaveBeenCalledWith({});
  });

  describe('permission gating', () => {
    const reflector = new Reflector();

    it('gates the overview behind analytics.view', () => {
      const perms = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, controller.getOverview);
      expect(perms).toEqual(['analytics.view']);
    });

    it('gates the export behind analytics.export (not analytics.view)', () => {
      const perms = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, controller.exportCsv);
      expect(perms).toEqual(['analytics.export']);
    });
  });
});
