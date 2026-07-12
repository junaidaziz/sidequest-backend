import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Global like PrismaModule — Redis is cross-cutting infra (caching today,
 * available for future session/rate-limit use), not owned by one feature. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
