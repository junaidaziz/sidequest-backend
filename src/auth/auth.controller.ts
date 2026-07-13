import {
  Body,
  Controller,
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
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
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
    summary: "Revoke the caller's server-side refresh token (invalidates future /auth/refresh)",
  })
  @ApiResponse({ status: 200, type: LogoutResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  logout(@CurrentUser() user: AuthUser): Promise<LogoutResponseDto> {
    return this.authService.logout(user.userId);
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
  @ApiOperation({ summary: "Update the authenticated user's display name" })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 400, description: 'displayName missing or outside the 1-50 char range' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<UserProfileDto> {
    return this.authService.updateDisplayName(user.userId, dto.displayName);
  }
}
