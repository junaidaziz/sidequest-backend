import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for `POST /payment/setup-intent`. The `clientSecret` is handed to the
 * mobile Stripe `PaymentSheet`, which completes card collection against Stripe
 * directly — the raw card never touches this backend.
 */
export class SetupIntentResponseDto {
  @ApiProperty({
    description:
      "The SetupIntent client secret for the mobile PaymentSheet. Not a persisted secret — it authorizes only this one setup attempt for the user's Stripe customer.",
    example: 'seti_1AbC2D_secret_XyZ...',
  })
  clientSecret!: string;
}
