import { Test, TestingModule } from '@nestjs/testing';
import { GenerateMissionsDto } from './dto/generate-missions.dto';
import { GenerateMissionsResponseDto } from './dto/mission-response.dto';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

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

  beforeEach(async () => {
    generate = jest.fn().mockResolvedValue(RESULT);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MissionsController],
      providers: [{ provide: MissionsService, useValue: { generate } }],
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
});
