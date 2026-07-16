import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskEvidenceDto } from './dto/submit-task-evidence.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import {
  PaginatedTasksDto,
  TaskDetailDto,
  TaskDto,
  TaskSubmissionDto,
} from './dto/task-response.dto';
import { TaskSummaryDto } from './dto/task-summary.dto';
import { TasksService } from './tasks.service';

/** Rejects non-image evidence at the HTTP boundary, before Multer buffers it. */
export function evidenceFileFilter(
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

/** Shared Swagger doc for the optional idempotency header. */
const IDEMPOTENCY_API_HEADER = {
  name: IDEMPOTENCY_KEY_HEADER,
  required: false,
  description:
    'Optional client-generated key (UUID). Reusing it on a retry returns the ' +
    'original response verbatim instead of re-executing the mutation.',
} as const;

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiOperation({ summary: 'Create a task. No assignee at creation = personal task.' })
  @ApiResponse({ status: 201, type: TaskDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  createTask(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTaskDto,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<TaskDto> {
    return this.tasksService.createTask(user.userId, dto, idempotencyKey);
  }

  @Get()
  @ApiOperation({
    summary: 'List tasks where the caller is creator or assignee; filter by status.',
  })
  @ApiResponse({ status: 200, type: PaginatedTasksDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  listTasks(
    @CurrentUser() user: AuthUser,
    @Query() query: ListTasksQueryDto,
  ): Promise<PaginatedTasksDto> {
    return this.tasksService.listTasks(user.userId, query);
  }

  // Declared before `:id` so the static `summary` segment is matched first.
  @Get('summary')
  @ApiOperation({ summary: 'Dashboard-style task counts for the current user (Decision 11).' })
  @ApiResponse({ status: 200, type: TaskSummaryDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getSummary(@CurrentUser() user: AuthUser): Promise<TaskSummaryDto> {
    return this.tasksService.getSummary(user.userId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Task detail + submission history (participants only).' })
  @ApiResponse({ status: 200, type: TaskDetailDto })
  @ApiResponse({ status: 403, description: 'Caller is not the creator or assignee' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskDetailDto> {
    return this.tasksService.getTask(user.userId, id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a task (creator only; only while Open/Invited — Decision 10).' })
  @ApiResponse({ status: 200, type: TaskDto })
  @ApiResponse({ status: 403, description: 'Caller is not the creator' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 409, description: 'Task is no longer editable (past Invited)' })
  updateTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    return this.tasksService.updateTask(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel/soft-delete a task (creator only; any time before Approved).' })
  @ApiResponse({ status: 200, type: TaskDto })
  @ApiResponse({ status: 403, description: 'Caller is not the creator' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 409, description: 'An approved task cannot be cancelled' })
  cancelTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskDto> {
    return this.tasksService.cancelTask(user.userId, id);
  }

  @Post(':id/invite')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Generate a shareable invite link (creator only; no active assignee).' })
  @ApiResponse({ status: 201, type: InviteResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the creator' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({
    status: 409,
    description: 'Task already has an assignee or is in a non-invitable state',
  })
  generateInvite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InviteResponseDto> {
    return this.tasksService.generateInvite(user.userId, id);
  }

  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiParam({ name: 'token', description: 'Invite token from the shared link.' })
  @ApiOperation({ summary: 'Accept an invite (guest or account) — binds the assignee.' })
  @ApiResponse({ status: 200, type: TaskDto })
  @ApiResponse({ status: 400, description: 'Cannot accept your own task invite' })
  @ApiResponse({ status: 404, description: 'Invite not found or no longer valid' })
  @ApiResponse({ status: 409, description: 'Task already has an assignee' })
  acceptInvite(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<TaskDto> {
    return this.tasksService.acceptInvite(user.userId, token, idempotencyKey);
  }

  @Post('invites/:token/decline')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiParam({ name: 'token', description: 'Invite token from the shared link.' })
  @ApiOperation({ summary: 'Decline an invite — clears the token so it cannot re-bind.' })
  @ApiResponse({ status: 200, type: TaskDto })
  @ApiResponse({ status: 404, description: 'Invite not found or no longer valid' })
  @ApiResponse({ status: 409, description: 'Invite is no longer open' })
  declineInvite(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<TaskDto> {
    return this.tasksService.declineInvite(user.userId, token, idempotencyKey);
  }

  @Post(':id/submissions')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PROOF_PHOTO_BYTES, files: 1 },
      fileFilter: evidenceFileFilter,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Submit evidence. Auto-resolves for NONE/SELF; awaits review for CREATOR_APPROVAL.',
  })
  @ApiBody({
    description: 'Optional photo evidence plus optional notes.',
    schema: {
      type: 'object',
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Image evidence (image/jpeg, image/png or image/webp, max 10MB).',
        },
        notes: { type: 'string', maxLength: 2000, description: 'Optional free-text notes.' },
      },
    },
  })
  @ApiResponse({ status: 201, type: TaskDetailDto })
  @ApiResponse({
    status: 400,
    description:
      'Evidence required but missing, unsupported image type, or a self-completion ' +
      'CREATOR_APPROVAL submission (Decision 2)',
  })
  @ApiResponse({ status: 403, description: 'Caller is not the task doer' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 409, description: 'Task is not in a submittable state' })
  submitEvidence(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @Body() dto: SubmitTaskEvidenceDto,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<TaskDetailDto> {
    return this.tasksService.submitEvidence(user.userId, id, photo, dto, idempotencyKey);
  }

  @Get(':id/submissions')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Submission/evidence history (participants only).' })
  @ApiResponse({ status: 200, type: [TaskSubmissionDto] })
  @ApiResponse({ status: 403, description: 'Caller is not a participant' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  listSubmissions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskSubmissionDto[]> {
    return this.tasksService.listSubmissions(user.userId, id);
  }

  @Patch(':id/submissions/:submissionId/review')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_API_HEADER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'submissionId', format: 'uuid' })
  @ApiOperation({
    summary: 'Approve or reject a submission (creator only; CREATOR_APPROVAL tasks).',
  })
  @ApiResponse({ status: 200, type: TaskDetailDto })
  @ApiResponse({
    status: 400,
    description: 'Missing rejectionReason on Reject, or non-approval task',
  })
  @ApiResponse({ status: 403, description: 'Caller is not the creator' })
  @ApiResponse({ status: 404, description: 'Task or submission not found' })
  @ApiResponse({ status: 409, description: 'Submission already reviewed' })
  reviewSubmission(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ReviewSubmissionDto,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<TaskDetailDto> {
    return this.tasksService.reviewSubmission(user.userId, id, submissionId, dto, idempotencyKey);
  }
}
