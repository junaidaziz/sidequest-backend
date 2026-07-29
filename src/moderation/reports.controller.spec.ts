import { Test, TestingModule } from '@nestjs/testing';
import { ModerationTargetType } from '@prisma/client';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { CreateReportDto } from './dto/create-report.dto';
import { CreateReportResponseDto } from './dto/report-response.dto';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

const USER: AuthUser = { userId: 'user-1', email: null, isGuest: false };
const TARGET_ID = '33333333-3333-3333-3333-333333333333';

describe('ReportsController', () => {
  let controller: ReportsController;
  let createReport: jest.Mock;

  const dto: CreateReportDto = {
    targetType: ModerationTargetType.Completion,
    targetId: TARGET_ID,
    reason: 'Inappropriate photo',
  };

  const response: CreateReportResponseDto = {
    reportId: 'report-1',
    status: 'Open' as CreateReportResponseDto['status'],
    targetType: ModerationTargetType.Completion,
    targetId: TARGET_ID,
    hiddenForReporter: true,
    globallyHidden: false,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    createReport = jest.fn().mockResolvedValue(response);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: { createReport } }],
    }).compile();

    controller = module.get(ReportsController);
  });

  it('POST /reports forwards the caller id + DTO to the service', async () => {
    const result = await controller.createReport(USER, dto);

    expect(createReport).toHaveBeenCalledWith('user-1', dto);
    expect(createReport).toHaveBeenCalledTimes(1);
    expect(result).toBe(response);
  });
});
