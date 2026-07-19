import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailModule } from '../email/email.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminCryptoService } from './admin-crypto.service';
import { AdminLockoutService } from './admin-lockout.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminTokenService } from './admin-token.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';

/**
 * Admin authentication module. Registers its OWN JwtModule bound to
 * ADMIN_JWT_SECRET (module-scoped — never collides with AuthModule's user-facing
 * JwtModule) and the 'admin-jwt' Passport strategy alongside the existing 'jwt'
 * one. Exports the guard/strategy + AdminAuthService so the rbac module can reuse
 * them. PrismaService and RedisService come from their global modules.
 */
@Module({
  imports: [
    PassportModule,
    EmailModule,
    AuditLogModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('ADMIN_JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminMfaService,
    AdminTokenService,
    AdminLockoutService,
    AdminCryptoService,
    AdminJwtStrategy,
  ],
  exports: [AdminAuthService, AdminMfaService, PassportModule, JwtModule],
})
export class AdminAuthModule {}
