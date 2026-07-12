import { Module } from '@nestjs/common';
import { MissionPoolService } from './mission-pool.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

@Module({
  controllers: [MissionsController],
  providers: [MissionsService, MissionPoolService],
  exports: [MissionPoolService],
})
export class MissionsModule {}
