import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { HomeResponseDto } from './dto/home-response.dto';
import { HomeService } from './home.service';

@ApiTags('home')
@ApiBearerAuth()
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  /**
   * Aggregated Home screen payload. Guarded, but works identically for guests
   * (who hold a valid JWT with isGuest: true) and signed-in users — it does not
   * discriminate on account type.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Aggregated Home screen data: level, streak, daily mission, saved packs',
  })
  @ApiResponse({ status: 200, type: HomeResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getHome(@CurrentUser() user: AuthUser): Promise<HomeResponseDto> {
    return this.homeService.getHome(user.userId);
  }
}
