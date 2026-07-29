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

  // Cross-field target-filter checks (backend-eval B1-WARN, Phase 11 review):
  // an inverted range or a self-contradictory combination used to silently
  // resolve to a 0-user audience instead of a 400.
  describe('CampaignTargetFilterDto cross-field validation', () => {
    it('accepts a coherent range and rejects nothing extra', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, {
        minTotalXp: 10,
        maxTotalXp: 100,
        registeredAfter: '2026-01-01T00:00:00Z',
        registeredBefore: '2026-06-01T00:00:00Z',
      });
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('rejects maxTotalXp below minTotalXp', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, { minTotalXp: 100, maxTotalXp: 10 });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects registeredBefore earlier than registeredAfter', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, {
        registeredAfter: '2026-06-01T00:00:00Z',
        registeredBefore: '2026-01-01T00:00:00Z',
      });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects activeSince and inactiveSince set together', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, {
        activeSince: '2026-01-01T00:00:00Z',
        inactiveSince: '2026-02-01T00:00:00Z',
      });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('accepts activeSince alone and inactiveSince alone', () => {
      expect(
        validateSync(
          plainToInstance(CampaignTargetFilterDto, { activeSince: '2026-01-01T00:00:00Z' }),
        ),
      ).toHaveLength(0);
      expect(
        validateSync(
          plainToInstance(CampaignTargetFilterDto, { inactiveSince: '2026-01-01T00:00:00Z' }),
        ),
      ).toHaveLength(0);
    });

    it('accepts a userIds array of UUIDs (single-user targeting)', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, {
        userIds: ['11111111-1111-4111-8111-111111111111'],
      });
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('rejects a userIds entry that is not a UUID', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, { userIds: ['not-a-uuid'] });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects a userIds value that is not an array', () => {
      const dto = plainToInstance(CampaignTargetFilterDto, {
        userIds: '11111111-1111-4111-8111-111111111111',
      });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });
  });
});
