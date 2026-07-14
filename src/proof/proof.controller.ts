import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeader,
} from '../idempotency/idempotency-key.decorator';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_PROOF_PHOTO_BYTES } from '../storage/storage.service';
import { ProofResponseDto } from './dto/proof-response.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { ProofService } from './proof.service';

/**
 * Rejects non-image uploads at the HTTP boundary before Multer buffers them.
 * StorageService.buildProofKey performs the same allow-list check as defense in
 * depth, so the rule lives in exactly one constant.
 */
export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
    cb(null, true);
    return;
  }
  cb(new BadRequestException('UNSUPPORTED_IMAGE_TYPE'), false);
}

/** Shared Swagger doc for the optional idempotency header (mirrors TasksController). */
const IDEMPOTENCY_API_HEADER = {
  name: IDEMPOTENCY_KEY_HEADER,
  required: false,
  description:
    'Optional client-generated key (UUID). Reusing it on a retry returns the ' +
    'original response verbatim instead of re-executing the submission — the ' +
    "offline write-queue sends one so a replayed proof submit can't double-award XP.",
} as const;

@ApiTags('proof')
@ApiBearerAuth()
@Controller('missions/:missionId/proof')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  // Proof submission is a sensitive, side-effecting write — tighter than the
  // global default per the project's rate-limit policy.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PROOF_PHOTO_BYTES, files: 1 },
      fileFilter: imageFileFilter,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiParam({ name: 'missionId', format: 'uuid' })
  @ApiOperation({
    summary: 'Submit photo or text proof for a mission, awarding XP and updating the streak',
  })
  // Documented with an explicit multipart schema (not `type: SubmitProofDto`)
  // so the binary `photo` field appears alongside `caption` in Swagger — the
  // DTO intentionally omits `photo` (see SubmitProofDto).
  @ApiBody({
    description: 'Provide exactly one of photo or caption — supplying both or neither is a 400.',
    schema: {
      type: 'object',
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Image proof (image/jpeg, image/png or image/webp, max 10MB).',
        },
        caption: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'Text proof caption. Provide photo OR caption, never both.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: ProofResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Neither or both of photo/caption supplied, caption out of 1-500 range, ' +
      'or an unsupported image type',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description:
      'Guest has already used their one free completion (GUEST_COMPLETION_LIMIT_REACHED)',
  })
  @ApiResponse({ status: 404, description: 'Mission not found or inactive' })
  @ApiResponse({ status: 413, description: 'Photo exceeds the 10MB limit' })
  @ApiResponse({
    status: 409,
    description: 'A request with this Idempotency-Key is already in progress — retry shortly',
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @Body() dto: SubmitProofDto,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<ProofResponseDto> {
    return this.proofService.submitProof(
      user.userId,
      missionId,
      photo,
      dto.caption,
      idempotencyKey,
    );
  }
}
