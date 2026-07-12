import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { GenerateMissionsDto } from './dto/generate-missions.dto';
import { GenerateMissionsResponseDto } from './dto/mission-response.dto';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

const USER: AuthUser = { userId: 'user-1', email: null, isGuest: false };
const MISSION_ID = '11111111-1111-1111-1111-111111111111';

const RESULT: GenerateMissionsResponseDto = {
  missions: [
    {
      id: 'uuid-1',
      category: 'explore',
      title: 'Find the Oldest Thing',
      desc: 'Short teaser.',
      full: 'The full brief.',
      proof: 'Photograph it.',
      time: '20 min',
      xp: '+40 XP',
      diff: 'Easy',
      dots: 1,
    },
  ],
};

describe('MissionsController', () => {
  let controller: MissionsController;
  let generate: jest.Mock;
  let saveMission: jest.Mock;
  let unsaveMission: jest.Mock;

  beforeEach(async () => {
    generate = jest.fn().mockResolvedValue(RESULT);
    saveMission = jest.fn().mockResolvedValue({ saved: true });
    unsaveMission = jest.fn().mockResolvedValue({ saved: false });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MissionsController],
      providers: [{ provide: MissionsService, useValue: { generate, saveMission, unsaveMission } }],
    }).compile();

    controller = module.get(MissionsController);
  });

  it('POST /missions/generate forwards the DTO to the service', async () => {
    const dto: GenerateMissionsDto = {
      crew: 'Solo',
      time: '30 min',
      setting: 'Outdoors',
      budget: 'Free',
    };

    const result = await controller.generate(dto);

    expect(generate).toHaveBeenCalledWith(dto);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toBe(RESULT);
  });

  it('POST /missions/:id/save forwards user id + mission id and returns { saved: true }', async () => {
    const result = await controller.saveMission(USER, MISSION_ID);

    expect(saveMission).toHaveBeenCalledWith('user-1', MISSION_ID);
    expect(result).toEqual({ saved: true });
  });

  it('DELETE /missions/:id/save forwards user id + mission id and returns { saved: false }', async () => {
    const result = await controller.unsaveMission(USER, MISSION_ID);

    expect(unsaveMission).toHaveBeenCalledWith('user-1', MISSION_ID);
    expect(result).toEqual({ saved: false });
  });
});
