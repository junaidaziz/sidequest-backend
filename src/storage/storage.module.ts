import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Provides the S3-compatible StorageService to any feature module that needs to
 * persist or presign objects (currently proof submission). ConfigService is
 * available globally via the app's ConfigModule.forRoot({ isGlobal: true }).
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
