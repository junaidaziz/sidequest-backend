import { AuthUser } from '../auth/types/jwt-payload.interface';
import { TasksController, evidenceFileFilter } from './tasks.controller';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { SubmitTaskEvidenceDto } from './dto/submit-task-evidence.dto';
import { BadRequestException } from '@nestjs/common';

const user: AuthUser = { userId: 'user-1', email: null, isGuest: false };

describe('TasksController', () => {
  let controller: TasksController;
  let service: jest.Mocked<TasksService>;

  beforeEach(() => {
    service = {
      createTask: jest.fn(),
      listTasks: jest.fn(),
      getTask: jest.fn(),
      updateTask: jest.fn(),
      cancelTask: jest.fn(),
      generateInvite: jest.fn(),
      acceptInvite: jest.fn(),
      declineInvite: jest.fn(),
      submitEvidence: jest.fn(),
      listSubmissions: jest.fn(),
      reviewSubmission: jest.fn(),
      getSummary: jest.fn(),
    } as unknown as jest.Mocked<TasksService>;
    controller = new TasksController(service);
  });

  it('delegates createTask with the idempotency key', async () => {
    const dto: CreateTaskDto = { title: 'Walk dog' };
    await controller.createTask(user, dto, 'key-1');
    expect(service.createTask).toHaveBeenCalledWith('user-1', dto, 'key-1');
  });

  it('delegates listTasks with query', async () => {
    await controller.listTasks(user, { status: undefined, role: 'creator' });
    expect(service.listTasks).toHaveBeenCalledWith('user-1', {
      status: undefined,
      role: 'creator',
    });
  });

  it('delegates getSummary', async () => {
    await controller.getSummary(user);
    expect(service.getSummary).toHaveBeenCalledWith('user-1');
  });

  it('delegates getTask', async () => {
    await controller.getTask(user, 'task-1');
    expect(service.getTask).toHaveBeenCalledWith('user-1', 'task-1');
  });

  it('delegates updateTask', async () => {
    const dto: UpdateTaskDto = { title: 'New' };
    await controller.updateTask(user, 'task-1', dto);
    expect(service.updateTask).toHaveBeenCalledWith('user-1', 'task-1', dto);
  });

  it('delegates cancelTask', async () => {
    await controller.cancelTask(user, 'task-1');
    expect(service.cancelTask).toHaveBeenCalledWith('user-1', 'task-1');
  });

  it('delegates generateInvite', async () => {
    await controller.generateInvite(user, 'task-1');
    expect(service.generateInvite).toHaveBeenCalledWith('user-1', 'task-1');
  });

  it('delegates acceptInvite with the idempotency key', async () => {
    await controller.acceptInvite(user, 'tok', 'key-2');
    expect(service.acceptInvite).toHaveBeenCalledWith('user-1', 'tok', 'key-2');
  });

  it('delegates declineInvite with the idempotency key', async () => {
    await controller.declineInvite(user, 'tok', undefined);
    expect(service.declineInvite).toHaveBeenCalledWith('user-1', 'tok', undefined);
  });

  it('delegates submitEvidence with file and idempotency key', async () => {
    const dto: SubmitTaskEvidenceDto = { notes: 'done' };
    const file = { mimetype: 'image/png' } as Express.Multer.File;
    await controller.submitEvidence(user, 'task-1', file, dto, 'key-3');
    expect(service.submitEvidence).toHaveBeenCalledWith('user-1', 'task-1', file, dto, 'key-3');
  });

  it('delegates listSubmissions', async () => {
    await controller.listSubmissions(user, 'task-1');
    expect(service.listSubmissions).toHaveBeenCalledWith('user-1', 'task-1');
  });

  it('delegates reviewSubmission', async () => {
    const dto: ReviewSubmissionDto = { decision: 'Approve' };
    await controller.reviewSubmission(user, 'task-1', 'sub-1', dto, 'key-4');
    expect(service.reviewSubmission).toHaveBeenCalledWith(
      'user-1',
      'task-1',
      'sub-1',
      dto,
      'key-4',
    );
  });
});

describe('evidenceFileFilter', () => {
  it('accepts a supported image type', () => {
    const cb = jest.fn();
    evidenceFileFilter({}, { mimetype: 'image/png' } as Express.Multer.File, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('rejects an unsupported type with a BadRequestException', () => {
    const cb = jest.fn();
    evidenceFileFilter({}, { mimetype: 'image/gif' } as Express.Multer.File, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });
});
