import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [MissionsModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
