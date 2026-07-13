import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard, ADMIN_KEY_HEADER } from '../auth/guards/admin.guard';
import { AdminService } from './admin.service';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { VerificationResponseDto } from './dto/verification-response.dto';

/**
 * Userless admin surface, gated by AdminGuard (shared `x-admin-key` header).
 * Thin: routing, guard, DTO binding, and Swagger only — all logic in AdminService.
 */
@ApiTags('admin')
@ApiHeader({ name: ADMIN_KEY_HEADER, description: 'Shared admin API key.', required: true })
@Controller('admin/completions')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Patch(':id/verification')
  // Bounds automated abuse if the shared admin key is ever compromised —
  // legitimate dashboard use is nowhere near this rate.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Completion id.' })
  @ApiOperation({ summary: 'Manually approve or reject a Pending completion' })
  @ApiResponse({ status: 200, type: VerificationResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid status, or missing rejectionReason on Rejected',
  })
  @ApiResponse({
    status: 403,
    description: 'Missing/invalid admin key, or admin access not configured',
  })
  @ApiResponse({ status: 404, description: 'Completion not found' })
  @ApiResponse({ status: 409, description: 'Completion is no longer Pending' })
  updateVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVerificationDto,
  ): Promise<VerificationResponseDto> {
    return this.adminService.updateVerification(id, dto);
  }
}
