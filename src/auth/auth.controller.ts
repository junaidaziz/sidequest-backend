import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePasswordResponseDto } from './dto/change-password-response.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { DeleteAccountResponseDto } from './dto/delete-account-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordResetResponseDto } from './dto/password-reset-response.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LogoutDto } from './dto/logout.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser } from './types/jwt-payload.interface';

/** Tighter than the global 100/60s default — brute-force / spam surface. */
const SENSITIVE_THROTTLE = { default: { limit: 5, ttl: 60_000 } } as const;
/**
 * Unauthenticated + writes a new User row — cap spam account creation.
 * A guest row is near-costless (no email, no verification) so this is a
 * DB-noise cap rather than a hard security boundary; kept above single
 * digits so shared-NAT users (campus/office wifi) creating concurrent guest
 * sessions don't collide, and so the proof.e2e-spec.ts concurrency test
 * (7 guest creations in one run) has headroom.
 */
const GUEST_THROTTLE = { default: { limit: 10, ttl: 60_000 } } as const;
/** Unauthenticated but requires a valid signed refresh token to do anything. */
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 60_000 } } as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('guest')
  @Throttle(GUEST_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bootstrap an anonymous guest session' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  createGuest(): Promise<AuthResponseDto> {
    return this.authService.createGuest();
  }

  @Post('signup')
  @Throttle(SENSITIVE_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a full account (upgrades a guest in place if bearer is a guest token)',
  })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  signup(
    @Body() dto: SignupDto,
    @Headers('authorization') authorization?: string,
  ): Promise<AuthResponseDto> {
    return this.authService.signup(dto, authorization);
  }

  @Post('google')
  @Throttle(SENSITIVE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with a Google ID token',
    description:
      'Verifies a Google-issued ID token and resolves to one of four outcomes: ' +
      'returns a returning Google user, auto-links Google to an existing account ' +
      'matching the verified email, upgrades a guest in place if a guest bearer ' +
      'token is supplied, or creates a brand-new full account. 200 is returned for ' +
      'every outcome since both new-account and existing-account results are possible.',
  })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Google authentication failed' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  google(
    @Body() dto: GoogleAuthDto,
    @Headers('authorization') authorization?: string,
  ): Promise<AuthResponseDto> {
    return this.authService.googleAuth(dto, authorization);
  }

  @Post('login')
  @Throttle(SENSITIVE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  // Same sensitive tier (5/60s) as login/signup per backend/CLAUDE.md — an
  // unauthenticated endpoint that triggers an email send, so it must be throttled
  // tightly to cap both brute-force enumeration attempts and email spam.
  @Post('forgot-password')
  @Throttle(SENSITIVE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a consumer password-reset email',
    description:
      'Always returns 200 with { success: true }, regardless of whether the email ' +
      'maps to an account, to avoid leaking account existence. When it does map to ' +
      'a live password account, a single-use, time-limited reset link is emailed.',
  })
  @ApiResponse({ status: 200, type: PasswordResetResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<PasswordResetResponseDto> {
    await this.authService.forgotPassword(dto);
    return { success: true };
  }

  // Same sensitive tier (5/60s) — validates a reset token and mutates the
  // credential; brute-force of the token warrants tight limiting.
  @Post('reset-password')
  @Throttle(SENSITIVE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a consumer password reset with the emailed token',
    description:
      'Validates the single-use token, stores a new bcrypt hash, and revokes the ' +
      "user's refresh token so existing sessions are invalidated (consistent with " +
      'PATCH /auth/password).',
  })
  @ApiResponse({ status: 200, type: PasswordResetResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed, or invalid/expired token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<PasswordResetResponseDto> {
    return this.authService.resetPassword(dto);
  }

  @Post('refresh')
  @Throttle(REFRESH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a rotated token pair' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Revoke the caller's server-side refresh token (invalidates future /auth/refresh) " +
      'and, if a push token is supplied, deregister it for this device.',
  })
  @ApiResponse({ status: 200, type: LogoutResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto): Promise<LogoutResponseDto> {
    return this.authService.logout(user.userId, dto.pushToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Return the authenticated user's public profile" })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  me(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.authService.getProfile(user.userId);
  }

  // Authenticated, low-abuse-risk write — the global 100/60s default is the
  // right tier here, matching how the equivalent POST /missions/:id/save
  // authenticated mutation is (not) throttled; no tighter @Throttle needed.
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Update the authenticated user's profile (display name and/or timezone)",
  })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({
    status: 400,
    description: 'displayName outside the 1-50 char range, or timezone is not a valid IANA zone',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserProfileDto> {
    return this.authService.updateProfile(user.userId, dto);
  }

  // Same sensitive tier (5/60s) as login/signup/google — a password change is a
  // credential-mutation surface (brute-force of currentPassword) that warrants
  // tighter limiting than the authenticated default.
  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @Throttle(SENSITIVE_THROTTLE)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Change the authenticated user's password",
    description:
      'Verifies the current password with bcrypt, then stores a new hash. An ' +
      'account with no password (Google-only or guest) receives a distinct 400 ' +
      'rather than a confusing "wrong password".',
  })
  @ApiResponse({ status: 200, type: ChangePasswordResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, no password set on this account, or new password unchanged',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing/invalid access token or wrong current password',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponseDto> {
    return this.authService.changePassword(user.userId, dto);
  }

  // Same sensitive tier (5/60s) as login/signup — deleting an account requires
  // re-authentication (current password, or confirm=true for a no-password
  // account), so it is a credential-verification surface that must be throttled
  // like one, not left on the authenticated default.
  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @Throttle(SENSITIVE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Soft-delete and anonymize the authenticated user's account",
    description:
      'Requires re-authentication in the body: currentPassword for a password ' +
      'account, or confirm=true for a Google-only/guest account with no password. ' +
      'Sets deletedAt, revokes the refresh token, scrubs display identity, ' +
      'de-references owned proof/evidence media, and deregisters all push tokens. ' +
      "The caller's existing tokens stop working immediately.",
  })
  @ApiResponse({ status: 200, type: DeleteAccountResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, or missing re-authentication (currentPassword / confirm)',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing/invalid access token or wrong current password',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
  ): Promise<DeleteAccountResponseDto> {
    return this.authService.deleteAccount(user.userId, dto);
  }
}
