import { VerificationStatus } from '@prisma/client';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

const ACTOR: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'a@b.co',
  roleId: 'role-1',
  sessionId: 'sess-1',
  mfaPending: false,
  mustChangePassword: false,
};
const IP = '10.0.0.1';
const UA = 'jest-agent';
const ID = '11111111-1111-1111-1111-111111111111';

/** The audit context the controller must assemble from the request. */
const EXPECTED_CTX = { actorAdminUserId: 'admin-1', ipAddress: IP, userAgent: UA };

describe('ModerationController', () => {
  let controller: ModerationController;
  let service: {
    getQueue: jest.Mock;
    listActions: jest.Mock;
    listReports: jest.Mock;
    getReport: jest.Mock;
    updateReport: jest.Mock;
    createAction: jest.Mock;
    listAppeals: jest.Mock;
    decideAppeal: jest.Mock;
    reviewProof: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getQueue: jest.fn().mockResolvedValue('queue'),
      listActions: jest.fn().mockResolvedValue('actions'),
      listReports: jest.fn().mockResolvedValue('reports'),
      getReport: jest.fn().mockResolvedValue('report'),
      updateReport: jest.fn().mockResolvedValue('updated'),
      createAction: jest.fn().mockResolvedValue('action'),
      listAppeals: jest.fn().mockResolvedValue('appeals'),
      decideAppeal: jest.fn().mockResolvedValue('appeal'),
      reviewProof: jest.fn().mockResolvedValue('proof'),
    };
    controller = new ModerationController(service as unknown as ModerationService);
  });

  it('delegates the queue read', async () => {
    await expect(controller.getQueue({})).resolves.toBe('queue');
    expect(service.getQueue).toHaveBeenCalledWith({});
  });

  it('delegates the moderation-action history read', async () => {
    await expect(controller.listActions({})).resolves.toBe('actions');
    expect(service.listActions).toHaveBeenCalledWith({});
  });

  it('delegates the report list and detail reads', async () => {
    await expect(controller.listReports({})).resolves.toBe('reports');
    await expect(controller.getReport(ID)).resolves.toBe('report');
    expect(service.getReport).toHaveBeenCalledWith(ID);
  });

  it('threads the audit context on updateReport', async () => {
    await controller.updateReport(ACTOR, ID, { status: 'Resolved' as never }, IP, UA);
    expect(service.updateReport).toHaveBeenCalledWith(ID, { status: 'Resolved' }, EXPECTED_CTX);
  });

  it('threads the audit context on createAction', async () => {
    const dto = { actionType: 'WarnUser' as never, reason: 'r' };
    await controller.createAction(ACTOR, ID, dto, IP, UA);
    expect(service.createAction).toHaveBeenCalledWith(ID, dto, EXPECTED_CTX);
  });

  it('delegates the appeal list and threads context on decideAppeal', async () => {
    await controller.listAppeals({});
    await controller.decideAppeal(ACTOR, ID, { decision: 'Upheld' as never }, IP, UA);
    expect(service.decideAppeal).toHaveBeenCalledWith(ID, { decision: 'Upheld' }, EXPECTED_CTX);
  });

  it('threads the audit context on reviewProof', async () => {
    await controller.reviewProof(ACTOR, ID, { status: VerificationStatus.Approved }, IP, UA);
    expect(service.reviewProof).toHaveBeenCalledWith(
      ID,
      { status: VerificationStatus.Approved },
      EXPECTED_CTX,
    );
  });

  it('defaults a missing user-agent to null in the context', async () => {
    await controller.reviewProof(ACTOR, ID, { status: VerificationStatus.Approved }, IP);
    expect(service.reviewProof).toHaveBeenCalledWith(
      ID,
      { status: VerificationStatus.Approved },
      { actorAdminUserId: 'admin-1', ipAddress: IP, userAgent: null },
    );
  });
});
