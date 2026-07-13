import { ApiProperty } from '@nestjs/swagger';

/**
 * A saved card, projected down to only the display-safe fields. Deliberately
 * NOT the raw Stripe PaymentMethod object — Stripe never returns a full PAN, but
 * we also don't want to leak fingerprints, billing details, or internal Stripe
 * structure to the client. `last4` + `brand` + expiry is all the mobile UI needs
 * to render a card row.
 */
export class PaymentMethodDto {
  @ApiProperty({
    description: 'Stripe PaymentMethod id. Used to set-default or detach this card.',
    example: 'pm_1AbC2D3EfGhIjK',
  })
  id!: string;

  @ApiProperty({
    description: 'Card network brand.',
    example: 'visa',
  })
  brand!: string;

  @ApiProperty({
    description: 'Last four digits of the card (Stripe never exposes the full number).',
    example: '4242',
  })
  last4!: string;

  @ApiProperty({
    description: 'Card expiry month, 1-12.',
    example: 12,
  })
  expMonth!: number;

  @ApiProperty({
    description: 'Card expiry year, four digits.',
    example: 2028,
  })
  expYear!: number;

  @ApiProperty({
    description: "Whether this is the customer's default payment method.",
    example: true,
  })
  isDefault!: boolean;
}
