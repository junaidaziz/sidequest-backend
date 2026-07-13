import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { StripeService } from './stripe.service';

/**
 * Payment-methods-on-file (SetupIntent + card attach/detach/set-default). No
 * charge/PaymentIntent flow exists — nothing is billed. PrismaService is global
 * via PrismaModule; ConfigService is global via ConfigModule.forRoot; AuthModule
 * is imported for its JWT passport strategy so JwtAuthGuard works on these routes.
 */
@Module({
  imports: [AuthModule],
  controllers: [PaymentController],
  providers: [PaymentService, StripeService],
})
export class PaymentModule {}
