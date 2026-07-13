import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { PaymentMethodDto } from './dto/payment-method.dto';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

const USER: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };

const CARD: PaymentMethodDto = {
  id: 'pm_1',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2028,
  isDefault: true,
};

describe('PaymentController', () => {
  let controller: PaymentController;
  let service: {
    createSetupIntent: jest.Mock;
    listPaymentMethods: jest.Mock;
    detachPaymentMethod: jest.Mock;
    setDefaultPaymentMethod: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createSetupIntent: jest.fn().mockResolvedValue({ clientSecret: 'secret' }),
      listPaymentMethods: jest.fn().mockResolvedValue([CARD]),
      detachPaymentMethod: jest.fn().mockResolvedValue([]),
      setDefaultPaymentMethod: jest.fn().mockResolvedValue([CARD]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: service }],
    }).compile();

    controller = module.get(PaymentController);
  });

  it('POST /payment/setup-intent delegates with the caller id and returns the secret', async () => {
    await expect(controller.createSetupIntent(USER)).resolves.toEqual({ clientSecret: 'secret' });
    expect(service.createSetupIntent).toHaveBeenCalledWith(USER.userId);
  });

  it('GET /payment/methods returns the mapped list', async () => {
    await expect(controller.listPaymentMethods(USER)).resolves.toEqual([CARD]);
    expect(service.listPaymentMethods).toHaveBeenCalledWith(USER.userId);
  });

  it('DELETE /payment/methods/:id forwards the caller id and payment-method id', async () => {
    await expect(controller.detachPaymentMethod(USER, 'pm_1')).resolves.toEqual([]);
    expect(service.detachPaymentMethod).toHaveBeenCalledWith(USER.userId, 'pm_1');
  });

  it('PATCH /payment/methods/:id/default forwards the caller id and payment-method id', async () => {
    await expect(controller.setDefaultPaymentMethod(USER, 'pm_1')).resolves.toEqual([CARD]);
    expect(service.setDefaultPaymentMethod).toHaveBeenCalledWith(USER.userId, 'pm_1');
  });
});
