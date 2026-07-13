import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { PaymentMethodDto } from './dto/payment-method.dto';
import { SetupIntentResponseDto } from './dto/setup-intent-response.dto';
import { PaymentService } from './payment.service';

/**
 * Payment-methods-on-file routes. Every route is JWT-guarded and scoped to the
 * calling user — the controller stays thin: guard, param binding, Swagger, then
 * a single delegation to PaymentService. All ownership and Stripe logic lives in
 * the service.
 */
@ApiTags('payment')
@ApiBearerAuth()
@Controller('payment')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('setup-intent')
  @HttpCode(HttpStatus.OK)
  // Creating a SetupIntent hits Stripe and may provision a customer — a
  // side-effecting external call, so tighter than the global default, matching
  // the avatar/proof write tiers.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create a SetupIntent for the mobile PaymentSheet to register a card',
  })
  @ApiResponse({ status: 200, type: SetupIntentResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 502, description: 'Payment provider unavailable' })
  createSetupIntent(@CurrentUser() user: AuthUser): Promise<SetupIntentResponseDto> {
    return this.paymentService.createSetupIntent(user.userId);
  }

  @Get('methods')
  @ApiOperation({ summary: "List the authenticated user's saved cards" })
  @ApiResponse({ status: 200, type: PaymentMethodDto, isArray: true })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 502, description: 'Payment provider unavailable' })
  listPaymentMethods(@CurrentUser() user: AuthUser): Promise<PaymentMethodDto[]> {
    return this.paymentService.listPaymentMethods(user.userId);
  }

  @Delete('methods/:id')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Detach one of the authenticated user's saved cards",
  })
  @ApiParam({ name: 'id', description: 'Stripe PaymentMethod id (pm_...)' })
  @ApiResponse({
    status: 200,
    type: PaymentMethodDto,
    isArray: true,
    description: 'The remaining saved cards after detaching',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Card not found or not owned by the caller' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 502, description: 'Payment provider unavailable' })
  detachPaymentMethod(
    @CurrentUser() user: AuthUser,
    @Param('id') paymentMethodId: string,
  ): Promise<PaymentMethodDto[]> {
    return this.paymentService.detachPaymentMethod(user.userId, paymentMethodId);
  }

  @Patch('methods/:id/default')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Set one of the authenticated user's saved cards as the default",
  })
  @ApiParam({ name: 'id', description: 'Stripe PaymentMethod id (pm_...)' })
  @ApiResponse({
    status: 200,
    type: PaymentMethodDto,
    isArray: true,
    description: 'The saved cards with the new default flagged',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Card not found or not owned by the caller' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiResponse({ status: 502, description: 'Payment provider unavailable' })
  setDefaultPaymentMethod(
    @CurrentUser() user: AuthUser,
    @Param('id') paymentMethodId: string,
  ): Promise<PaymentMethodDto[]> {
    return this.paymentService.setDefaultPaymentMethod(user.userId, paymentMethodId);
  }
}
