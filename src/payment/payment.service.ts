import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentMethodDto } from './dto/payment-method.dto';
import { SetupIntentResponseDto } from './dto/setup-intent-response.dto';
import { StripeService } from './stripe.service';

/**
 * Payment-methods-on-file for the authenticated user: create a SetupIntent so
 * the mobile PaymentSheet can register a card, then list / set-default / detach
 * saved cards. There is NO charge flow — nothing is ever billed here; this is
 * purely "let a user keep a card on record for later".
 *
 * All Stripe I/O and Stripe-error mapping lives in StripeService; this service
 * owns the business rules: first-setup customer creation (race-safe), the
 * ownership check that stops a user touching another user's card, and the
 * projection of Stripe objects down to the display-safe PaymentMethodDto.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Returns a SetupIntent client secret for the caller, provisioning their
   * Stripe customer on first use.
   *
   * Race handling: two concurrent first-time calls could each see no
   * stripeCustomerId and each create a Stripe customer, orphaning one and
   * racing on the DB write. We serialize with a `SELECT ... FOR UPDATE` row lock
   * inside a transaction — the exact pattern ProofService uses for its
   * completion ledger. The second caller blocks on the lock until the first
   * commits, then reads the now-persisted customerId and reuses it. Exactly one
   * Stripe customer is ever created per user. (The lock is held across one
   * Stripe customers.create call; acceptable for this low-frequency,
   * once-per-user endpoint, and it is the only correctness-critical section.)
   */
  async createSetupIntent(userId: string): Promise<SetupIntentResponseDto> {
    const customerId = await this.ensureStripeCustomer(userId);
    const setupIntent = await this.stripe.createSetupIntent(customerId);

    if (!setupIntent.client_secret) {
      // Stripe always returns a client_secret on a freshly created SetupIntent;
      // guard defensively so we never hand the client an empty secret.
      this.logger.error(`SetupIntent ${setupIntent.id} created without a client_secret`);
      throw new NotFoundException('Unable to initialize payment setup');
    }

    return { clientSecret: setupIntent.client_secret };
  }

  /**
   * Lists the caller's saved cards with the default flagged. When the user has
   * never run a SetupIntent (no stripeCustomerId) there is nothing to list, so
   * this returns an empty array rather than erroring.
   */
  async listPaymentMethods(userId: string): Promise<PaymentMethodDto[]> {
    const customerId = await this.getCustomerId(userId);
    if (!customerId) {
      return [];
    }

    const [methods, defaultId] = await Promise.all([
      this.stripe.listCardPaymentMethods(customerId),
      this.stripe.getDefaultPaymentMethodId(customerId),
    ]);

    return methods.map((method) => this.toDto(method, defaultId));
  }

  /**
   * Detaches one of the caller's saved cards. Verifies the payment method
   * actually belongs to the caller's Stripe customer first — the `:id` param
   * alone is never trusted, so a user cannot detach another user's card by
   * guessing an id. Returns the remaining cards so the client can refresh.
   */
  async detachPaymentMethod(userId: string, paymentMethodId: string): Promise<PaymentMethodDto[]> {
    const customerId = await this.assertOwnsPaymentMethod(userId, paymentMethodId);
    await this.stripe.detachPaymentMethod(paymentMethodId);
    this.logger.log(`Detached payment method for user ${userId}`);

    const [methods, defaultId] = await Promise.all([
      this.stripe.listCardPaymentMethods(customerId),
      this.stripe.getDefaultPaymentMethodId(customerId),
    ]);
    return methods.map((method) => this.toDto(method, defaultId));
  }

  /**
   * Marks one of the caller's saved cards as their default. Same ownership check
   * as detach. Returns the updated list with the new default flagged.
   */
  async setDefaultPaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<PaymentMethodDto[]> {
    const customerId = await this.assertOwnsPaymentMethod(userId, paymentMethodId);
    await this.stripe.setDefaultPaymentMethod(customerId, paymentMethodId);
    this.logger.log(`Set default payment method for user ${userId}`);

    const methods = await this.stripe.listCardPaymentMethods(customerId);
    return methods.map((method) => this.toDto(method, paymentMethodId));
  }

  /**
   * Resolves the caller's Stripe customer id, creating and persisting it on
   * first use under a row lock (see createSetupIntent's doc for the race
   * rationale).
   */
  private async ensureStripeCustomer(userId: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { id: string; email: string | null; stripeCustomerId: string | null }[]
      >`
        SELECT id, email, "stripeCustomerId"
        FROM users WHERE id = ${userId} FOR UPDATE`;

      if (!locked) {
        // Defensive: JwtStrategy already rejects tokens for deleted/missing users.
        throw new NotFoundException('User not found');
      }
      if (locked.stripeCustomerId) {
        return locked.stripeCustomerId;
      }

      const customer = await this.stripe.createCustomer({ email: locked.email, userId });
      await tx.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
      this.logger.log(`Created Stripe customer for user ${userId}`);
      return customer.id;
    });
  }

  /** Reads the persisted Stripe customer id without creating one. */
  private async getCustomerId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.stripeCustomerId;
  }

  /**
   * Confirms the payment method exists AND is attached to the caller's own
   * Stripe customer. Returns that customer id on success. A user with no
   * customer, a nonexistent payment method, or a card belonging to a different
   * customer all yield a 404 — identical responses so an attacker cannot
   * distinguish "not yours" from "doesn't exist" and enumerate ids.
   */
  private async assertOwnsPaymentMethod(userId: string, paymentMethodId: string): Promise<string> {
    const customerId = await this.getCustomerId(userId);
    if (!customerId) {
      throw new NotFoundException('Payment method not found');
    }

    // A resource_missing id throws inside StripeService and is mapped to 404.
    const method = await this.stripe.retrievePaymentMethod(paymentMethodId);
    const owner = typeof method.customer === 'string' ? method.customer : method.customer?.id;
    if (owner !== customerId) {
      throw new NotFoundException('Payment method not found');
    }
    return customerId;
  }

  /** Projects a raw Stripe PaymentMethod down to the display-safe DTO. */
  private toDto(method: Stripe.PaymentMethod, defaultId: string | null): PaymentMethodDto {
    const card = method.card;
    return {
      id: method.id,
      brand: card?.brand ?? 'unknown',
      last4: card?.last4 ?? '',
      expMonth: card?.exp_month ?? 0,
      expYear: card?.exp_year ?? 0,
      isDefault: defaultId !== null && method.id === defaultId,
    };
  }
}
