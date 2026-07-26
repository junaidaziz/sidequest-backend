import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { StorageModule } from '../storage/storage.module';
import { MediaModule } from '../media/media.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // StorageService resolves the avatar S3 object key to a presigned GET URL
    // when building UserProfileDto.
    StorageModule,
    // MediaService resolves User.avatarMediaId's ready variants into
    // UserProfileDto.avatarVariants. One-directional: AuthModule ->
    // MediaModule; MediaModule does not import AuthModule.
    MediaModule,
    // Referral-code attribution at signup / Google sign-in (M20.3). One-
    // directional: AuthModule -> ReferralsModule; ReferralsModule does not
    // import AuthModule, so there is no dependency cycle.
    ReferralsModule,
    // Push-token deregistration on logout (M21.3). One-directional:
    // AuthModule -> NotificationsModule; NotificationsModule does not import
    // AuthModule, so there is no dependency cycle.
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  // Exported so later feature modules can reuse the strategy/guard and service.
  exports: [AuthService, PassportModule, JwtModule],
})
export class AuthModule {}
