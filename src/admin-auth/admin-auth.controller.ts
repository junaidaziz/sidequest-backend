import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService, AdminRequestContext } from './admin-auth.service';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AdminLoginResponseDto, AdminTokenPairDto } from './dto/admin-auth-response.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminMfaChallengeDto } from './dto/admin-mfa-challenge.dto';
import { AdminMfaSetupResponseDto, AdminMfaVerifyResponseDto } from './dto/admin-mfa-response.dto';
import { AdminMfaVerifyDto } from './dto/admin-mfa-verify.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminSessionDto } from './dto/admin-session.dto';
import { AdminSuccessResponseDto } from './dto/generic-response.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AuthAdmin } from './types/admin-jwt-payload.interface';

/** Flat per-IP brute-force cap on the login surface (in addition to durable lockout). */
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } } as const;
/** Slightly looser tier for the other credential/token surfaces. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } } as const;

/**
 * Admin authentication surface. The login/challenge/refresh/forgot/reset/accept
 * endpoints are unauthenticated (guarded by throttling + tokens); logout/sessions
 * and MFA setup/verify require a valid admin access token. These self-service
 * endpoints act only on the caller's own account, so they are intentionally NOT
 * @RequirePermission-gated (an admin with minimal permissions must still be able
 * to log out and enroll their own MFA) — permission gating starts at the rbac
 * routes that act on OTHER resources.
 */
@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly service: AdminAuthService) {}

  private ctx(ip: string, userAgent?: string): AdminRequestContext {
    return { ipAddress: ip, userAgent: userAgent ?? null };
  }

  @Post('login')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login (returns tokens or an MFA challenge)' })
  @ApiResponse({ status: 200, type: AdminLoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials or locked account' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  login(
    @Body() dto: AdminLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminLoginResponseDto> {
    return this.service.login(dto, this.ctx(ip, userAgent));
  }

  @Post('mfa/challenge')
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a pending MFA login with a TOTP or recovery code' })
  @ApiResponse({ status: 200, type: AdminTokenPairDto })
  @ApiResponse({ status: 401, description: 'Invalid/expired challenge or bad code' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  challenge(
    @Body() dto: AdminMfaChallengeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminTokenPairDto> {
    return this.service.completeMfaChallenge(dto, this.ctx(ip, userAgent));
  }

  @Post('mfa/setup')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a TOTP secret + otpauth URL for the authenticated admin' })
  @ApiResponse({ status: 200, type: AdminMfaSetupResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  @ApiResponse({ status: 409, description: 'MFA already enabled' })
  setupMfa(
    @CurrentAdmin() admin: AuthAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminMfaSetupResponseDto> {
    return this.service.setupMfa(admin, this.ctx(ip, userAgent));
  }

  @Post('mfa/verify')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the first TOTP code, enable MFA, return recovery codes' })
  @ApiResponse({ status: 200, type: AdminMfaVerifyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid code or setup not started' })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  verifyMfa(
    @CurrentAdmin() admin: AuthAdmin,
    @Body() dto: AdminMfaVerifyDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminMfaVerifyResponseDto> {
    return this.service.verifyMfa(admin, dto.code, this.ctx(ip, userAgent));
  }

  @Post('refresh')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the admin token pair' })
  @ApiResponse({ status: 200, type: AdminTokenPairDto })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  refresh(
    @Body() dto: AdminRefreshDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminTokenPairDto> {
    return this.service.refresh(dto, this.ctx(ip, userAgent));
  }

  @Post('logout')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the caller's current session" })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async logout(
    @CurrentAdmin() admin: AuthAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.logout(admin, this.ctx(ip, userAgent));
    return { success: true };
  }

  @Post('logout-all')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session for the caller (log out everywhere)' })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  async logoutAll(
    @CurrentAdmin() admin: AuthAdmin,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.logoutAll(admin, this.ctx(ip, userAgent));
    return { success: true };
  }

  @Get('sessions')
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the caller's sessions (device/login history)" })
  @ApiResponse({ status: 200, type: [AdminSessionDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  sessions(@CurrentAdmin() admin: AuthAdmin): Promise<AdminSessionDto[]> {
    return this.service.listSessions(admin);
  }

  @Post('password/forgot')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password-reset email (always 200 — no enumeration)' })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async forgotPassword(
    @Body() dto: AdminForgotPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.forgotPassword(dto, this.ctx(ip, userAgent));
    return { success: true };
  }

  @Post('password/reset')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset with the emailed token' })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid/expired token or weak password' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resetPassword(
    @Body() dto: AdminResetPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.resetPassword(dto, this.ctx(ip, userAgent));
    return { success: true };
  }

  @Post('invitations/accept')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an admin invitation by setting a password (token in body)' })
  @ApiResponse({ status: 200, type: AdminTokenPairDto })
  @ApiResponse({ status: 400, description: 'Invalid/expired invitation or weak password' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminTokenPairDto> {
    return this.service.acceptInvitation(dto.token, dto, this.ctx(ip, userAgent));
  }
}
