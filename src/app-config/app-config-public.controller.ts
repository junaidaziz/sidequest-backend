import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from './app-config.service';
import { PublicAppConfigDto } from './dto/app-config.dto';

/**
 * Unauthenticated public config surface. Returns only the code-reviewed
 * allow-list of public keys (store URLs, min app versions, public contact/legal
 * links) — never an internal feature flag. Cached (best-effort) via Redis.
 */
@ApiTags('config-public')
// Generous per-IP cap for public traffic, overriding the mobile-tuned global.
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('config')
export class AppConfigPublicController {
  constructor(private readonly service: AppConfigService) {}

  @Get('public')
  @ApiOperation({ summary: 'Public application config (allow-listed keys only)' })
  @ApiResponse({ status: 200, type: PublicAppConfigDto })
  async getPublic(): Promise<PublicAppConfigDto> {
    return { config: await this.service.getPublic() };
  }
}
