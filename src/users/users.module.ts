import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Authenticated profile-media routes (avatar upload/delete). PrismaService is
 * global via PrismaModule; StorageModule provides the S3-backed StorageService;
 * AuthModule is imported for its JWT strategy/guard and AuthService (reused to
 * build the resolved UserProfileDto).
 */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
