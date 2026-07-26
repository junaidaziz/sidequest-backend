import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { imageFileFilter } from '../proof/proof.controller';
import { MAX_AVATAR_PHOTO_BYTES } from '../storage/storage.service';
import { SetAvatarFromMediaDto } from './dto/set-avatar-from-media.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/avatar')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  // Avatar upload writes to S3 — a side-effecting write, tighter than the global
  // default, mirroring proof submission's 20/60s tier.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    // Mirrors proof.controller: same imageFileFilter (ALLOWED_IMAGE_MIME_TYPES)
    // and a Multer size cap — a smaller 5MB cap than proofs (see
    // MAX_AVATAR_PHOTO_BYTES). Field name is `avatar`.
    FileInterceptor('avatar', {
      limits: { fileSize: MAX_AVATAR_PHOTO_BYTES, files: 1 },
      fileFilter: imageFileFilter,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: "Upload or replace the authenticated user's profile avatar",
  })
  @ApiBody({
    description: 'A single image file (image/jpeg, image/png or image/webp, max 5MB).',
    schema: {
      type: 'object',
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image (image/jpeg, image/png or image/webp, max 5MB).',
        },
      },
    },
  })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 400, description: 'No file supplied or an unsupported image type' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 413, description: 'Avatar exceeds the 5MB limit' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() avatar: Express.Multer.File | undefined,
  ): Promise<UserProfileDto> {
    if (!avatar) {
      throw new BadRequestException('An avatar image file is required');
    }
    return this.usersService.uploadAvatar(user.userId, avatar);
  }

  @Post('media')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  // Matches the multipart upload endpoint's tier — this also does S3/DB
  // writes (a pointer swap plus best-effort cleanup of whatever it replaces).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Set the authenticated user's avatar from an already-uploaded, already-processed media asset " +
      '(the direct-to-S3 pipeline path — see POST /media/uploads)',
  })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({
    status: 400,
    description: 'The media asset is not AVATAR-purpose or is not yet READY',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 404, description: 'Media asset not found or not owned by the caller' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  setAvatarFromMedia(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetAvatarFromMediaDto,
  ): Promise<UserProfileDto> {
    return this.usersService.setAvatarFromMedia(user.userId, dto.mediaId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  // Matches the upload endpoint's tier — this also does an S3 write
  // (DeleteObjectCommand), so it shouldn't be five times more permissive
  // than upload under the global default.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Remove the authenticated user's profile avatar — idempotent",
  })
  @ApiResponse({ status: 200, type: UserProfileDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  deleteAvatar(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.usersService.deleteAvatar(user.userId);
  }
}
