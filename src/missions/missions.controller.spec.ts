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
  let listSaved: jest.Mock;
  let getById: jest.Mock;

  beforeEach(async () => {
    generate = jest.fn().mockResolvedValue(RESULT);
    saveMission = jest.fn().mockResolvedValue({ saved: true });
    unsaveMission = jest.fn().mockResolvedValue({ saved: false });
    listSaved = jest.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    getById = jest.fn().mockResolvedValue(RESULT.missions[0]);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MissionsController],
      providers: [
        {
          provide: MissionsService,
          useValue: { generate, saveMission, unsaveMission, listSaved, getById },
        },
      ],
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

  it('GET /missions/:missionId forwards the mission id and returns the mission', async () => {
    const result = await controller.getMission(MISSION_ID);

    expect(getById).toHaveBeenCalledWith(MISSION_ID);
    expect(result).toBe(RESULT.missions[0]);
  });

  it('GET /missions/saved forwards user id + query to the service', async () => {
    const page = { items: [], total: 0, limit: 5, offset: 10 };
    listSaved.mockResolvedValue(page);

    const result = await controller.listSaved(USER, { limit: 5, offset: 10 });

    expect(listSaved).toHaveBeenCalledWith('user-1', { limit: 5, offset: 10 });
    expect(result).toBe(page);
  });
});
