import { VerificationStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { VerificationResponseDto } from './dto/verification-response.dto';

const COMPLETION_ID = '77777777-7777-7777-7777-777777777777';

function response(): VerificationResponseDto {
  return {
    completionId: COMPLETION_ID,
    verificationStatus: VerificationStatus.Approved,
    verifiedAt: new Date('2026-07-13T00:00:00.000Z'),
    verifiedBy: 'admin',
    rejectionReason: null,
  };
}

describe('AdminController', () => {
  let controller: AdminController;
  let service: { updateVerification: jest.Mock };

  beforeEach(async () => {
    service = { updateVerification: jest.fn().mockResolvedValue(response()) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: service }],
    })
      // AdminGuard is unit-tested separately; stub it here so the controller
      // wiring can be tested without a ConfigService.
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AdminController);
  });

  it('forwards the id and dto to the service and returns its result', async () => {
    const dto: UpdateVerificationDto = { status: VerificationStatus.Approved };

    const result = await controller.updateVerification(COMPLETION_ID, dto);

    expect(service.updateVerification).toHaveBeenCalledWith(COMPLETION_ID, dto);
    expect(result).toEqual(response());
  });
});
