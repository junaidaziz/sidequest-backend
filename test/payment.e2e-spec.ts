/**
 * Payment (payment-methods-on-file) e2e — INTENTIONALLY SKIPPED.
 *
 * Every route in the payment module makes a real Stripe API call (create
 * customer, create SetupIntent, list/retrieve/detach/update payment methods).
 * With the placeholder dev key (`sk_test_placeholder_not_a_real_key`) every one
 * of those calls fails with a Stripe 401 (which the service maps to a 502), so a
 * meaningful happy-path e2e cannot run here — and we deliberately do NOT mock
 * Stripe at this layer (an e2e that fakes the very dependency it exists to
 * exercise would be worse than none).
 *
 * The full behavioural surface (customer-creation race, ownership checks, DTO
 * mapping, Stripe-error → HTTP mapping) is covered by the unit specs:
 *   - src/payment/stripe.service.spec.ts
 *   - src/payment/payment.service.spec.ts
 *   - src/payment/payment.controller.spec.ts
 *
 * TODO(stripe): once a real Stripe TEST-MODE secret key is provisioned, enable
 * this suite — boot AppModule, mint a JWT via POST /auth/guest, then walk
 * setup-intent -> (attach a test card via Stripe's test PaymentMethod
 * `pm_card_visa`) -> list -> set-default -> detach against Stripe's test
 * environment, plus 401 (no bearer) and 404 (other user's / nonexistent card)
 * assertions. Blocked on the user supplying `STRIPE_SECRET_KEY` (sk_test_...).
 */
describe.skip('Payment methods (e2e) — requires a real Stripe test-mode key', () => {
  it('is skipped until STRIPE_SECRET_KEY (sk_test_...) is provisioned', () => {
    expect(true).toBe(true);
  });
});
