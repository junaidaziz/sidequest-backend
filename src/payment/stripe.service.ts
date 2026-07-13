import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper over the official Stripe Node SDK. Two jobs:
 *
 *  1. Own the single Stripe client, constructed from STRIPE_SECRET_KEY (required
 *     at boot via getOrThrow) — every other module goes through this service and
 *     never `new Stripe(...)` on its own.
 *  2. Funnel every Stripe API call through `wrap()`, which maps
 *     `Stripe.errors.StripeError` subclasses onto sensible Nest HTTP exceptions
 *     so a raw Stripe failure (a bad payment-method id, an auth failure from a
 *     placeholder key, a rate-limit) never leaks to the client as a 500 carrying
 *     internal Stripe detail. This mirrors the "catch third-party SDK errors at
 *     the boundary" intent; StorageService leaves S3 errors to the global
 *     filter, but Stripe's errors carry rich internal detail and map cleanly to
 *     specific statuses (resource_missing -> 404), so we special-case them here
 *     rather than in AllExceptionsFilter.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe;

  constructor(config: ConfigService) {
    // getOrThrow: a missing key is a boot-time misconfiguration, not a runtime
    // 500 later. With a placeholder key the client still constructs fine; the
    // first real API call fails honestly with a 401 from Stripe (mapped below).
    this.client = new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY'));
  }

  /** Creates a Stripe Customer, linked to the user's email when they have one. */
  async createCustomer(params: { email: string | null; userId: string }): Promise<Stripe.Customer> {
    return this.wrap(() =>
      this.client.customers.create({
        // Omit email entirely for a guest with no email rather than sending null.
        email: params.email ?? undefined,
        metadata: { userId: params.userId },
      }),
    );
  }

  /** Creates a SetupIntent for later off-session card setup for the customer. */
  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    return this.wrap(() =>
      this.client.setupIntents.create({
        customer: customerId,
        // Card-on-file only: no charge now, saved for potential future use.
        usage: 'off_session',
        payment_method_types: ['card'],
      }),
    );
  }

  /** Lists the customer's saved card payment methods. */
  async listCardPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    const result = await this.wrap(() =>
      this.client.paymentMethods.list({ customer: customerId, type: 'card' }),
    );
    return result.data;
  }

  /**
   * Returns the customer's default payment-method id (from
   * invoice_settings.default_payment_method), or null when none is set or the
   * customer has been deleted upstream.
   */
  async getDefaultPaymentMethodId(customerId: string): Promise<string | null> {
    const customer = await this.wrap(() => this.client.customers.retrieve(customerId));
    if (customer.deleted) {
      return null;
    }
    const value = customer.invoice_settings?.default_payment_method;
    if (!value) {
      return null;
    }
    return typeof value === 'string' ? value : value.id;
  }

  /**
   * Retrieves a single payment method. Used for the ownership check before
   * detach/set-default — a resource_missing here surfaces as a 404 via wrap().
   */
  async retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return this.wrap(() => this.client.paymentMethods.retrieve(paymentMethodId));
  }

  /** Detaches a payment method from whichever customer it is attached to. */
  async detachPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return this.wrap(() => this.client.paymentMethods.detach(paymentMethodId));
  }

  /** Sets the customer's default payment method for future off-session use. */
  async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<Stripe.Customer> {
    return this.wrap(() =>
      this.client.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      }),
    );
  }

  /**
   * Runs a Stripe call and translates any `Stripe.errors.StripeError` into a
   * Nest HTTP exception. Non-Stripe errors are rethrown untouched so the global
   * filter still turns a genuine bug into a 500 (we only special-case the SDK's
   * own error hierarchy). Never lets a raw Stripe error object reach the client.
   */
  private async wrap<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw this.toHttpException(error);
      }
      throw error;
    }
  }

  private toHttpException(error: Stripe.errors.StripeError): HttpException {
    // Log the internal detail server-side (type/code/message) but never return
    // it verbatim to the client. No card data is present on these fields.
    this.logger.warn(
      `Stripe error [type=${error.type} code=${error.code ?? 'n/a'} status=${
        error.statusCode ?? 'n/a'
      }]: ${error.message}`,
    );

    switch (error.type) {
      case 'StripeInvalidRequestError':
        // The most common case for our surface: a bad/enumerated payment-method
        // or customer id. Stripe uses code 'resource_missing' for a not-found
        // resource -> 404. Any other invalid-request is a 400.
        return error.code === 'resource_missing'
          ? new NotFoundException('Payment method not found')
          : new BadRequestException('Invalid payment request');
      case 'StripeCardError':
        // Card-level failures carry a user-safe decline message.
        return new BadRequestException(error.message);
      case 'StripeRateLimitError':
        return new ServiceUnavailableException('Payment provider is busy, please retry');
      case 'StripeAuthenticationError':
      case 'StripeConnectionError':
      case 'StripeAPIError':
      default:
        // Auth failures mean OUR key is wrong (a server misconfiguration, e.g.
        // the placeholder dev key), connection/API errors are upstream outages —
        // never the client's fault, so a 502, not a leaked 500.
        return new BadGatewayException('Payment provider is currently unavailable');
    }
  }
}
