import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { HomeResponseDto } from './dto/home-response.dto';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

const RESULT: HomeResponseDto = {
  level: { level: 1, xpIntoLevel: 0, xpToNextLevel: 100, totalXp: 0 },
  streak: { currentStreak: 0, longestStreak: 0 },
  dailyMission: null,
  pendingChallenges: [],
  savedPacks: [],
  taskStats: { total: 0, approved: 0, pending: 0, rejected: 0, completionRate: 0 },
};

const USER: AuthUser = { userId: 'user-1', email: null, isGuest: true };

describe('HomeController', () => {
  let controller: HomeController;
  let getHome: jest.Mock;

  beforeEach(async () => {
    getHome = jest.fn().mockResolvedValue(RESULT);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HomeController],
      providers: [{ provide: HomeService, useValue: { getHome } }],
    }).compile();

    controller = module.get(HomeController);
  });

  it('GET /home forwards the authenticated user id to the service', async () => {
    const result = await controller.getHome(USER);

    expect(getHome).toHaveBeenCalledWith('user-1');
    expect(getHome).toHaveBeenCalledTimes(1);
    expect(result).toBe(RESULT);
  });
});
