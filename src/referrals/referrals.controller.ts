import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeader,
} from '../idempotency/idempotency-key.decorator';
import { ReferralsService } from './referrals.service';
import { ReferralMeDto } from './dto/referral-me.dto';
import { RecordInviteDto } from './dto/record-invite.dto';
import { InviteRecordedDto } from './dto/invite-recorded.dto';
import { PaginatedReferralHistoryDto, ReferralHistoryQueryDto } from './dto/referral-history.dto';

/** Shared Swagger doc for the optional idempotency header. */
const IDEMPOTENCY_API_HEADER = {
  name: IDEMPOTENCY_KEY_HEADER,
  required: false,
  description:
    'Optional client-generated key (UUID). Reusing it on a retry returns the ' +
    'original response verbatim instead of recording a duplicate share event.',
} as const;

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('me')
  @ApiOperation({
    summary: "Return (creating on first call) the caller's referral code, link, and stats.",
  })
  @ApiResponse({ status: 200, type: ReferralMeDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 409,
    description: 'Code generation exhausted its collision-retry budget — retry the request',
  })
  getMe(@CurrentUser() user: AuthUser): Promise<ReferralMeDto> {
    return this.referralsService.getMe(user.userId);
  }

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiOperation({ summary: 'Record a best-effort "share sent" event for a channel.' })
  @ApiResponse({ status: 201, type: InviteRecordedDto })
  @ApiResponse({ status: 400, description: 'Unknown channel' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  recordInvite(
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordInviteDto,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<InviteRecordedDto> {
    return this.referralsService.recordInvite(user.userId, dto, idempotencyKey);
  }

  @Get('history')
  @ApiOperation({ summary: "Paginated list of the caller's individual referral records." })
  @ApiResponse({ status: 200, type: PaginatedReferralHistoryDto })
  @ApiResponse({ status: 400, description: 'Invalid pagination parameters' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: ReferralHistoryQueryDto,
  ): Promise<PaginatedReferralHistoryDto> {
    return this.referralsService.getHistory(user.userId, query);
  }
}
