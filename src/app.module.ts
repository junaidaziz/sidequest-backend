import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MissionsModule } from './missions/missions.module';
import { StorageModule } from './storage/storage.module';
import { ProofModule } from './proof/proof.module';
import { HomeModule } from './home/home.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    AuthModule,
    MissionsModule,
    StorageModule,
    ProofModule,
    HomeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
