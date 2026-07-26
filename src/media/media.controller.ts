import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import {
  CreateMediaUploadRequestDto,
  CreateMediaUploadResponseDto,
} from './dto/create-media-upload.dto';
import { MediaAssetResponseDto } from './dto/media-asset-response.dto';
import { MediaService } from './media.service';

/**
 * Reusable, purpose-agnostic media endpoints — the direct-to-S3 counterpart
 * to the legacy Multer-mediated upload routes still used by
 * `/users/me/avatar`, proof submission, and task-evidence submission. See the
 * class doc on MediaService for which purposes are actually wired to a real
 * feature endpoint today vs. implemented-but-not-yet-adopted.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authorize a direct-to-S3 upload and receive a presigned PUT URL' })
  @ApiResponse({ status: 201, type: CreateMediaUploadResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Unsupported MIME type, oversized declared fileSize, or a relatedEntityId invalid for the given purpose',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not a participant of the referenced task (TASK_ATTACHMENT only)',
  })
  @ApiResponse({ status: 404, description: 'Referenced mission or task not found' })
  createUpload(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMediaUploadRequestDto,
  ): Promise<CreateMediaUploadResponseDto> {
    return this.mediaService.createUploadAuthorization(user.userId, dto);
  }

  @Post('uploads/:uploadId/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiParam({
    name: 'uploadId',
    format: 'uuid',
    description: 'The mediaId returned by POST /media/uploads',
  })
  @ApiOperation({ summary: 'Confirm a direct-to-S3 upload completed and queue variant generation' })
  @ApiResponse({ status: 200, type: MediaAssetResponseDto })
  @ApiResponse({
    status: 400,
    description: 'No object found at the authorized key, or it exceeds the size cap',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Media asset not found or not owned by the caller' })
  confirmUpload(
    @CurrentUser() user: AuthUser,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<MediaAssetResponseDto> {
    return this.mediaService.confirmUpload(user.userId, uploadId);
  }

  @Get(':mediaId')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiOperation({ summary: 'Get a media asset and its ready delivery variants' })
  @ApiResponse({ status: 200, type: MediaAssetResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Media asset not found or not owned by the caller' })
  getMedia(
    @CurrentUser() user: AuthUser,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<MediaAssetResponseDto> {
    return this.mediaService.getMedia(user.userId, mediaId);
  }

  @Delete(':mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a media asset and its stored objects' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Media asset not found or not owned by the caller' })
  deleteMedia(
    @CurrentUser() user: AuthUser,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<void> {
    return this.mediaService.deleteMedia(user.userId, mediaId);
  }
}
