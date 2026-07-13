import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Admin verification override surface. PrismaService is global via PrismaModule;
 * AdminGuard depends only on the global ConfigService, so no extra imports are
 * needed here.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
