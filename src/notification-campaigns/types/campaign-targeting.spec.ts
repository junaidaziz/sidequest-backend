import { CampaignPushPlatform, buildTargetWhere } from './campaign-targeting';

describe('buildTargetWhere', () => {
  it('always excludes soft-deleted and suspended users, even with no filter', () => {
    expect(buildTargetWhere(null)).toEqual({ deletedAt: null, suspendedAt: null });
    expect(buildTargetWhere(undefined)).toEqual({ deletedAt: null, suspendedAt: null });
    expect(buildTargetWhere({})).toEqual({ deletedAt: null, suspendedAt: null });
  });

  it('maps a registration-date range onto User.createdAt', () => {
    const where = buildTargetWhere({
      registeredAfter: '2026-01-01T00:00:00Z',
      registeredBefore: '2026-06-01T00:00:00Z',
    });
    expect(where.createdAt).toEqual({
      gte: new Date('2026-01-01T00:00:00Z'),
      lte: new Date('2026-06-01T00:00:00Z'),
    });
  });

  it('maps an XP range onto User.totalXp', () => {
    expect(buildTargetWhere({ minTotalXp: 100 }).totalXp).toEqual({ gte: 100 });
    expect(buildTargetWhere({ maxTotalXp: 500 }).totalXp).toEqual({ lte: 500 });
    expect(buildTargetWhere({ minTotalXp: 100, maxTotalXp: 500 }).totalXp).toEqual({
      gte: 100,
      lte: 500,
    });
  });

  it('maps isGuest directly (including false)', () => {
    expect(buildTargetWhere({ isGuest: true }).isGuest).toBe(true);
    expect(buildTargetWhere({ isGuest: false }).isGuest).toBe(false);
  });

  it('maps activeSince onto a lastCompletionDate lower bound', () => {
    const where = buildTargetWhere({ activeSince: '2026-07-01T00:00:00Z' });
    expect(where.lastCompletionDate).toEqual({ gte: new Date('2026-07-01T00:00:00Z') });
  });

  it('maps inactiveSince onto an OR that includes never-completed users', () => {
    const where = buildTargetWhere({ inactiveSince: '2026-07-01T00:00:00Z' });
    expect(where.OR).toEqual([
      { lastCompletionDate: { lt: new Date('2026-07-01T00:00:00Z') } },
      { lastCompletionDate: null },
    ]);
  });

  it('maps the participation proxy onto the completions relation', () => {
    expect(buildTargetWhere({ hasParticipated: true }).completions).toEqual({ some: {} });
    expect(buildTargetWhere({ hasParticipated: false }).completions).toEqual({ none: {} });
  });

  it('maps the platform proxy onto an enabled push token on that platform', () => {
    const where = buildTargetWhere({ pushPlatform: CampaignPushPlatform.Ios });
    expect(where.pushTokens).toEqual({ some: { platform: 'ios', disabledAt: null } });
  });

  it('maps a single userIds entry onto id IN (single-user targeting)', () => {
    const where = buildTargetWhere({ userIds: ['user-1'] });
    expect(where.id).toEqual({ in: ['user-1'] });
    // The always-on exclusions remain AND-combined, so a targeted deleted/
    // suspended user is still excluded.
    expect(where.deletedAt).toBeNull();
    expect(where.suspendedAt).toBeNull();
  });

  it('maps multiple userIds onto id IN', () => {
    const where = buildTargetWhere({ userIds: ['a', 'b', 'c'] });
    expect(where.id).toEqual({ in: ['a', 'b', 'c'] });
  });

  it('maps an empty userIds array onto id IN [] (matches no one, by design)', () => {
    const where = buildTargetWhere({ userIds: [] });
    expect(where.id).toEqual({ in: [] });
  });

  it('AND-combines userIds with other cohort dimensions', () => {
    const where = buildTargetWhere({ userIds: ['user-1'], isGuest: false, minTotalXp: 100 });
    expect(where.id).toEqual({ in: ['user-1'] });
    expect(where.isGuest).toBe(false);
    expect(where.totalXp).toEqual({ gte: 100 });
  });

  it('omits the id clause entirely when userIds is absent', () => {
    expect(buildTargetWhere({ isGuest: true }).id).toBeUndefined();
  });
});
