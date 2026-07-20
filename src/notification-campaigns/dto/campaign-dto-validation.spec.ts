import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCampaignDto } from './create-campaign.dto';
import { ListCampaignsQueryDto } from './list-campaigns-query.dto';
import { CampaignTargetFilterDto } from './campaign-target-filter.dto';
import { CampaignPushPlatform } from '../types/campaign-targeting';

/**
 * Exercises the DTO transform/validation pipeline the way the global
 * ValidationPipe does at runtime — this is what invokes the `@Type(() => …)`
 * factory functions (nested targetFilter, numeric coercion) that unit tests on the
 * service/controller never trigger.
 */
describe('Campaign DTO validation', () => {
  it('accepts a well-formed create payload and instantiates the nested filter class', () => {
    const dto = plainToInstance(CreateCampaignDto, {
      title: 'Launch',
      headline: 'We launched',
      body: 'Check it out',
      data: { screen: 'home' },
      targetFilter: {
        minTotalXp: 100,
        isGuest: false,
        pushPlatform: CampaignPushPlatform.Ios,
      },
      scheduledAt: '2026-08-01T00:00:00Z',
    });
    expect(dto.targetFilter).toBeInstanceOf(CampaignTargetFilterDto);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a create payload missing required fields', () => {
    const dto = plainToInstance(CreateCampaignDto, { title: '' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects an out-of-vocab push platform in the nested filter', () => {
    const dto = plainToInstance(CreateCampaignDto, {
      title: 'T',
      headline: 'H',
      body: 'B',
      targetFilter: { pushPlatform: 'windows' },
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('coerces numeric query params via the @Type(() => Number) factory', () => {
    const query = plainToInstance(ListCampaignsQueryDto, { page: '2', pageSize: '50' });
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(50);
    expect(validateSync(query)).toHaveLength(0);
  });

  it('rejects a non-numeric page', () => {
    const query = plainToInstance(ListCampaignsQueryDto, { page: 'abc' });
    expect(validateSync(query).length).toBeGreaterThan(0);
  });
});
