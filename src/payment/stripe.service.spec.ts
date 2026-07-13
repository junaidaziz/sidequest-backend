import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

/**
 * Mock Stripe client shape — only the endpoints StripeService touches. The real
 * `stripe` module is NOT jest.mock()'d, so the genuine `Stripe.errors.*` classes
 * are used to exercise the `instanceof`-based error mapping.
 */
interface MockClient {
  customers: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock };
  setupIntents: { create: jest.Mock };
  paymentMethods: { list: jest.Mock; retrieve: jest.Mock; detach: jest.Mock };
}

function buildService(): { service: StripeService; client: MockClient } {
  const config = { getOrThrow: jest.fn().mockReturnValue('sk_test_x') };
  const service = new StripeService(config as unknown as ConfigService);
  const client: MockClient = {
    customers: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() },
    setupIntents: { create: jest.fn() },
    paymentMethods: { list: jest.fn(), retrieve: jest.fn(), detach: jest.fn() },
  };
  // Replace the real client built in the constructor with the mock.
  (service as unknown as { client: MockClient }).client = client;
  return { service, client };
}

describe('StripeService', () => {
  let service: StripeService;
  let client: MockClient;

  beforeEach(() => {
    ({ service, client } = buildService());
  });

  afterEach(() => jest.restoreAllMocks());

  describe('happy-path delegation', () => {
    it('createCustomer passes the email when present', async () => {
      client.customers.create.mockResolvedValue({ id: 'cus_1' });
      const result = await service.createCustomer({ email: 'ada@example.com', userId: 'u1' });
      expect(client.customers.create).toHaveBeenCalledWith({
        email: 'ada@example.com',
        metadata: { userId: 'u1' },
      });
      expect(result).toEqual({ id: 'cus_1' });
    });

    it('createCustomer omits email for a guest with none', async () => {
      client.customers.create.mockResolvedValue({ id: 'cus_2' });
      await service.createCustomer({ email: null, userId: 'u2' });
      expect(client.customers.create).toHaveBeenCalledWith({
        email: undefined,
        metadata: { userId: 'u2' },
      });
    });

    it('createSetupIntent requests an off_session card intent', async () => {
      client.setupIntents.create.mockResolvedValue({ id: 'seti_1', client_secret: 'secret' });
      const result = await service.createSetupIntent('cus_1');
      expect(client.setupIntents.create).toHaveBeenCalledWith({
        customer: 'cus_1',
        usage: 'off_session',
        payment_method_types: ['card'],
      });
      expect(result.client_secret).toBe('secret');
    });

    it('listCardPaymentMethods returns only the data array', async () => {
      client.paymentMethods.list.mockResolvedValue({ data: [{ id: 'pm_1' }] });
      const result = await service.listCardPaymentMethods('cus_1');
      expect(client.paymentMethods.list).toHaveBeenCalledWith({
        customer: 'cus_1',
        type: 'card',
      });
      expect(result).toEqual([{ id: 'pm_1' }]);
    });

    it('detachPaymentMethod delegates by id', async () => {
      client.paymentMethods.detach.mockResolvedValue({ id: 'pm_1' });
      await service.detachPaymentMethod('pm_1');
      expect(client.paymentMethods.detach).toHaveBeenCalledWith('pm_1');
    });

    it('setDefaultPaymentMethod updates invoice_settings', async () => {
      client.customers.update.mockResolvedValue({ id: 'cus_1' });
      await service.setDefaultPaymentMethod('cus_1', 'pm_1');
      expect(client.customers.update).toHaveBeenCalledWith('cus_1', {
        invoice_settings: { default_payment_method: 'pm_1' },
      });
    });

    it('retrievePaymentMethod delegates by id', async () => {
      client.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1' });
      const result = await service.retrievePaymentMethod('pm_1');
      expect(result).toEqual({ id: 'pm_1' });
    });
  });

  describe('getDefaultPaymentMethodId', () => {
    it('returns the id when set as a string', async () => {
      client.customers.retrieve.mockResolvedValue({
        deleted: false,
        invoice_settings: { default_payment_method: 'pm_default' },
      });
      await expect(service.getDefaultPaymentMethodId('cus_1')).resolves.toBe('pm_default');
    });

    it('returns the id when the default is an expanded object', async () => {
      client.customers.retrieve.mockResolvedValue({
        deleted: false,
        invoice_settings: { default_payment_method: { id: 'pm_obj' } },
      });
      await expect(service.getDefaultPaymentMethodId('cus_1')).resolves.toBe('pm_obj');
    });

    it('returns null when no default is set', async () => {
      client.customers.retrieve.mockResolvedValue({
        deleted: false,
        invoice_settings: { default_payment_method: null },
      });
      await expect(service.getDefaultPaymentMethodId('cus_1')).resolves.toBeNull();
    });

    it('returns null when invoice_settings is absent', async () => {
      client.customers.retrieve.mockResolvedValue({ deleted: false });
      await expect(service.getDefaultPaymentMethodId('cus_1')).resolves.toBeNull();
    });

    it('returns null when the customer was deleted upstream', async () => {
      client.customers.retrieve.mockResolvedValue({ deleted: true });
      await expect(service.getDefaultPaymentMethodId('cus_1')).resolves.toBeNull();
    });
  });

  describe('Stripe error mapping', () => {
    it('maps a resource_missing invalid-request to 404', async () => {
      client.paymentMethods.retrieve.mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: 'No such payment method',
        }),
      );
      await expect(service.retrievePaymentMethod('pm_x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps other invalid-request errors to 400', async () => {
      client.setupIntents.create.mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          code: 'parameter_unknown',
          message: 'Bad param',
        }),
      );
      await expect(service.createSetupIntent('cus_1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps a card error to 400 preserving the safe message', async () => {
      client.customers.update.mockRejectedValue(
        new Stripe.errors.StripeCardError({
          type: 'card_error',
          code: 'card_declined',
          message: 'Your card was declined.',
        }),
      );
      await expect(service.setDefaultPaymentMethod('cus_1', 'pm_1')).rejects.toMatchObject({
        message: 'Your card was declined.',
      });
    });

    it('maps a rate-limit error to 503', async () => {
      client.paymentMethods.list.mockRejectedValue(
        new Stripe.errors.StripeRateLimitError({
          type: 'rate_limit_error',
          message: 'Too many requests',
        }),
      );
      await expect(service.listCardPaymentMethods('cus_1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('maps an authentication error (bad/placeholder key) to 502', async () => {
      client.customers.create.mockRejectedValue(
        new Stripe.errors.StripeAuthenticationError({
          type: 'authentication_error',
          message: 'Invalid API Key provided',
        }),
      );
      await expect(service.createCustomer({ email: null, userId: 'u1' })).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('maps a connection error to 502', async () => {
      client.paymentMethods.detach.mockRejectedValue(
        new Stripe.errors.StripeConnectionError({
          message: 'Network error',
        }),
      );
      await expect(service.detachPaymentMethod('pm_1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('rethrows a non-Stripe error untouched for the global filter', async () => {
      const boom = new Error('unexpected');
      client.customers.retrieve.mockRejectedValue(boom);
      await expect(service.getDefaultPaymentMethodId('cus_1')).rejects.toBe(boom);
    });
  });
});
