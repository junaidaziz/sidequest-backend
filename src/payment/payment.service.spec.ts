import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from './payment.service';
import { StripeService } from './stripe.service';

const USER_ID = 'user-1';
const CUSTOMER_ID = 'cus_123';

function cardMethod(overrides: Partial<Stripe.PaymentMethod> = {}): Stripe.PaymentMethod {
  return {
    id: 'pm_1',
    customer: CUSTOMER_ID,
    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028 },
    ...overrides,
  } as unknown as Stripe.PaymentMethod;
}

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: {
    $transaction: jest.Mock;
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let stripe: {
    createCustomer: jest.Mock;
    createSetupIntent: jest.Mock;
    listCardPaymentMethods: jest.Mock;
    getDefaultPaymentMethodId: jest.Mock;
    retrievePaymentMethod: jest.Mock;
    detachPaymentMethod: jest.Mock;
    setDefaultPaymentMethod: jest.Mock;
  };

  /** tx handed to the $transaction callback — a locked-row query + user.update. */
  let tx: { $queryRaw: jest.Mock; user: { update: jest.Mock } };

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn(),
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    stripe = {
      createCustomer: jest.fn(),
      createSetupIntent: jest.fn(),
      listCardPaymentMethods: jest.fn(),
      getDefaultPaymentMethodId: jest.fn(),
      retrievePaymentMethod: jest.fn(),
      detachPaymentMethod: jest.fn(),
      setDefaultPaymentMethod: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripe },
      ],
    }).compile();

    service = module.get(PaymentService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createSetupIntent', () => {
    it('creates and persists a Stripe customer on first use, then returns the client secret', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: USER_ID, email: 'ada@example.com', stripeCustomerId: null },
      ]);
      stripe.createCustomer.mockResolvedValue({ id: CUSTOMER_ID });
      stripe.createSetupIntent.mockResolvedValue({ id: 'seti_1', client_secret: 'secret_abc' });

      const result = await service.createSetupIntent(USER_ID);

      expect(stripe.createCustomer).toHaveBeenCalledWith({
        email: 'ada@example.com',
        userId: USER_ID,
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { stripeCustomerId: CUSTOMER_ID },
      });
      expect(stripe.createSetupIntent).toHaveBeenCalledWith(CUSTOMER_ID);
      expect(result).toEqual({ clientSecret: 'secret_abc' });
    });

    it('reuses an existing Stripe customer without creating a new one', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: USER_ID, email: 'ada@example.com', stripeCustomerId: CUSTOMER_ID },
      ]);
      stripe.createSetupIntent.mockResolvedValue({ id: 'seti_1', client_secret: 'secret_abc' });

      await service.createSetupIntent(USER_ID);

      expect(stripe.createCustomer).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(stripe.createSetupIntent).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    it('throws NotFound when the locked user row is missing', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.createSetupIntent(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(stripe.createSetupIntent).not.toHaveBeenCalled();
    });

    it('throws when Stripe returns a SetupIntent without a client_secret', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: USER_ID, email: null, stripeCustomerId: CUSTOMER_ID }]);
      stripe.createSetupIntent.mockResolvedValue({ id: 'seti_1', client_secret: null });
      await expect(service.createSetupIntent(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listPaymentMethods', () => {
    it('returns an empty list when the user has no Stripe customer yet', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null });
      await expect(service.listPaymentMethods(USER_ID)).resolves.toEqual([]);
      expect(stripe.listCardPaymentMethods).not.toHaveBeenCalled();
    });

    it('throws NotFound when the user row does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.listPaymentMethods(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps saved cards to the display-safe DTO with the default flagged', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.listCardPaymentMethods.mockResolvedValue([
        cardMethod({ id: 'pm_1' }),
        cardMethod({ id: 'pm_2' }),
      ]);
      stripe.getDefaultPaymentMethodId.mockResolvedValue('pm_2');

      const result = await service.listPaymentMethods(USER_ID);

      expect(result).toEqual([
        { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028, isDefault: false },
        { id: 'pm_2', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028, isDefault: true },
      ]);
    });

    it('falls back to safe defaults when a card sub-object is missing', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.listCardPaymentMethods.mockResolvedValue([
        cardMethod({ id: 'pm_nocard', card: undefined }),
      ]);
      stripe.getDefaultPaymentMethodId.mockResolvedValue(null);

      const result = await service.listPaymentMethods(USER_ID);

      expect(result).toEqual([
        { id: 'pm_nocard', brand: 'unknown', last4: '', expMonth: 0, expYear: 0, isDefault: false },
      ]);
    });
  });

  describe('detachPaymentMethod (ownership-checked)', () => {
    it('detaches a card the caller owns and returns the remaining list', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.retrievePaymentMethod.mockResolvedValue(cardMethod({ id: 'pm_1' }));
      stripe.detachPaymentMethod.mockResolvedValue(cardMethod({ id: 'pm_1' }));
      stripe.listCardPaymentMethods.mockResolvedValue([cardMethod({ id: 'pm_2' })]);
      stripe.getDefaultPaymentMethodId.mockResolvedValue(null);

      const result = await service.detachPaymentMethod(USER_ID, 'pm_1');

      expect(stripe.detachPaymentMethod).toHaveBeenCalledWith('pm_1');
      expect(result.map((m) => m.id)).toEqual(['pm_2']);
    });

    it('resolves ownership when Stripe returns an expanded customer object', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.retrievePaymentMethod.mockResolvedValue(
        cardMethod({ id: 'pm_1', customer: { id: CUSTOMER_ID } as Stripe.Customer }),
      );
      stripe.detachPaymentMethod.mockResolvedValue(cardMethod());
      stripe.listCardPaymentMethods.mockResolvedValue([]);
      stripe.getDefaultPaymentMethodId.mockResolvedValue(null);

      await expect(service.detachPaymentMethod(USER_ID, 'pm_1')).resolves.toEqual([]);
      expect(stripe.detachPaymentMethod).toHaveBeenCalled();
    });

    it('throws 404 (never detaches) when the user has no Stripe customer', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null });
      await expect(service.detachPaymentMethod(USER_ID, 'pm_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(stripe.retrievePaymentMethod).not.toHaveBeenCalled();
      expect(stripe.detachPaymentMethod).not.toHaveBeenCalled();
    });

    it('throws 404 (never detaches) when the card belongs to another customer', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.retrievePaymentMethod.mockResolvedValue(
        cardMethod({ id: 'pm_1', customer: 'cus_someone_else' }),
      );
      await expect(service.detachPaymentMethod(USER_ID, 'pm_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(stripe.detachPaymentMethod).not.toHaveBeenCalled();
    });
  });

  describe('setDefaultPaymentMethod (ownership-checked)', () => {
    it('sets the default for an owned card and flags it in the returned list', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.retrievePaymentMethod.mockResolvedValue(cardMethod({ id: 'pm_1' }));
      stripe.setDefaultPaymentMethod.mockResolvedValue({ id: CUSTOMER_ID });
      stripe.listCardPaymentMethods.mockResolvedValue([
        cardMethod({ id: 'pm_1' }),
        cardMethod({ id: 'pm_2' }),
      ]);

      const result = await service.setDefaultPaymentMethod(USER_ID, 'pm_1');

      expect(stripe.setDefaultPaymentMethod).toHaveBeenCalledWith(CUSTOMER_ID, 'pm_1');
      expect(result.find((m) => m.id === 'pm_1')?.isDefault).toBe(true);
      expect(result.find((m) => m.id === 'pm_2')?.isDefault).toBe(false);
    });

    it('throws 404 (never updates) when the card is not owned by the caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID });
      stripe.retrievePaymentMethod.mockResolvedValue(
        cardMethod({ id: 'pm_1', customer: 'cus_other' }),
      );
      await expect(service.setDefaultPaymentMethod(USER_ID, 'pm_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(stripe.setDefaultPaymentMethod).not.toHaveBeenCalled();
    });

    it('throws 404 when the user has no Stripe customer', async () => {
      prisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null });
      await expect(service.setDefaultPaymentMethod(USER_ID, 'pm_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
