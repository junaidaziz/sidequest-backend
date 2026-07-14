import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { ProofResponseDto } from './dto/proof-response.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { ProofController, imageFileFilter } from './proof.controller';
import { ProofService } from './proof.service';

const MISSION_ID = '11111111-1111-1111-1111-111111111111';
const AUTH_USER: AuthUser = {
  userId: '22222222-2222-2222-2222-222222222222',
  email: null,
  isGuest: true,
};

function response(): ProofResponseDto {
  return {
    completionId: 'completion-1',
    missionTitle: 'Find the Oldest Thing',
    xpAwarded: 40,
    totalXp: 40,
    currentStreak: 1,
    longestStreak: 1,
    proofUrl: null,
  };
}

describe('ProofController', () => {
  let controller: ProofController;
  let service: { submitProof: jest.Mock };

  beforeEach(async () => {
    service = { submitProof: jest.fn().mockResolvedValue(response()) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ProofController],
      providers: [{ provide: ProofService, useValue: service }],
    }).compile();

    controller = moduleRef.get(ProofController);
  });

  it('forwards a text-proof submission to the service and returns its result', async () => {
    const dto: SubmitProofDto = { caption: 'Found it!' };

    const result = await controller.submit(AUTH_USER, MISSION_ID, undefined, dto, undefined);

    expect(service.submitProof).toHaveBeenCalledWith(
      AUTH_USER.userId,
      MISSION_ID,
      undefined,
      'Found it!',
      undefined,
    );
    expect(result).toEqual(response());
  });

  it('forwards the uploaded file for a photo-proof submission', async () => {
    const photo = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;
    const dto: SubmitProofDto = {};

    await controller.submit(AUTH_USER, MISSION_ID, photo, dto, undefined);

    expect(service.submitProof).toHaveBeenCalledWith(
      AUTH_USER.userId,
      MISSION_ID,
      photo,
      undefined,
      undefined,
    );
  });

  it('threads the Idempotency-Key header through to the service', async () => {
    const dto: SubmitProofDto = { caption: 'Found it!' };

    await controller.submit(AUTH_USER, MISSION_ID, undefined, dto, 'idem-key-42');

    expect(service.submitProof).toHaveBeenCalledWith(
      AUTH_USER.userId,
      MISSION_ID,
      undefined,
      'Found it!',
      'idem-key-42',
    );
  });

  describe('imageFileFilter', () => {
    it('accepts an allowed image MIME type', () => {
      const cb = jest.fn();
      imageFileFilter({}, { mimetype: 'image/jpeg' } as Express.Multer.File, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rejects a disallowed MIME type with a 400', () => {
      const cb = jest.fn();
      imageFileFilter({}, { mimetype: 'application/pdf' } as Express.Multer.File, cb);
      const [error, accepted] = cb.mock.calls[0];
      expect(error).toBeInstanceOf(BadRequestException);
      expect(accepted).toBe(false);
    });
  });
});
