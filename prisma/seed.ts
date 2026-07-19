import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Matches the admin-surface bcrypt cost used elsewhere (auth.service.ts). */
const BCRYPT_ROUNDS = 12;

/**
 * Curated v1 mission pool. The first 9 are ported verbatim (title/copy/time/xp)
 * from the mobile mockup's hardcoded set (mobileApp/src/screens/MissionResultsScreen.tsx)
 * so the real API returns content that has already been visually verified in
 * the mockup — only the crew/setting/cost tags are new, added for filtering.
 */
const MISSIONS = [
  {
    title: 'Find the Oldest Thing',
    category: 'explore' as const,
    description:
      "Locate the oldest object visible from where you're standing. Age wins. Document it.",
    fullBrief:
      "Look around you right now. What's the oldest thing you can see? It could be a building, a tree, a piece of infrastructure, or something someone left behind. The goal is to find it, learn what you can about its age, and document it.",
    proofRequirement:
      'Photograph the object and add a one-line caption with your best guess at its age.',
    estimatedMinutes: 20,
    xpReward: 40,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner', 'Friends', 'Family'],
    settingTags: ['Outdoors', 'City', 'Nature'],
    costTier: 0,
  },
  {
    title: 'The Balancing Act',
    category: 'create' as const,
    description:
      'Stack 5 natural objects you find into a tower. Photograph it before gravity wins.',
    fullBrief:
      'Source 5 natural objects — rocks, sticks, leaves, pinecones — from within a 2-minute walk. Stack them into the most stable tower you can manage. No glue. No cheating. Photograph it standing freely.',
    proofRequirement: 'Photo of your tower with at least 5 distinct layers clearly visible.',
    estimatedMinutes: 15,
    xpReward: 35,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner', 'Friends', 'Family'],
    settingTags: ['Outdoors', 'Nature'],
    costTier: 0,
  },
  {
    title: 'Neighborhood Newbie',
    category: 'discover' as const,
    description:
      "Walk one block in a direction you've never gone. Find something you've never noticed before.",
    fullBrief:
      "Pick a direction you almost never walk in — even if you've lived here for years. Walk at least one full block. Your mission is to find one thing you genuinely haven't noticed before and document it.",
    proofRequirement: 'Photograph your discovery. Caption: what made it surprising.',
    estimatedMinutes: 30,
    xpReward: 50,
    difficulty: 'Medium' as const,
    difficultyDots: 2,
    crewTags: ['Solo', 'Partner', 'Friends'],
    settingTags: ['Outdoors', 'City'],
    costTier: 0,
  },
  {
    title: 'Window Worlds',
    category: 'explore' as const,
    description: 'Find a window with an interesting reflection. Capture it from an unusual angle.',
    fullBrief:
      'Reflections in glass create layered worlds most people walk past. Your mission: find a window that shows something interesting — a doubled scene, an unexpected juxtaposition, or a distorted view — and photograph it from an unconventional angle.',
    proofRequirement: 'One photo. The more unexpected the composition, the better.',
    estimatedMinutes: 15,
    xpReward: 45,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner', 'Friends', 'Family'],
    settingTags: ['Indoors', 'City'],
    costTier: 0,
  },
  {
    title: "Nature's Palette",
    category: 'create' as const,
    description:
      'Collect 5 objects that form a colour gradient from light to dark. Arrange and photograph.',
    fullBrief:
      'An eye test and a design challenge in one. Find 5 natural objects — petals, stones, bark, leaves, seeds — that form a smooth gradient from your lightest to darkest find. Arrange them in order.',
    proofRequirement: 'One flat-lay photo showing all 5 items in clear light-to-dark order.',
    estimatedMinutes: 20,
    xpReward: 40,
    difficulty: 'Medium' as const,
    difficultyDots: 2,
    crewTags: ['Solo', 'Partner', 'Family'],
    settingTags: ['Outdoors', 'Nature'],
    costTier: 0,
  },
  {
    title: 'Sound Map',
    category: 'discover' as const,
    description: 'Stand still for 2 minutes. Log every distinct sound you hear. Screenshot your list.',
    fullBrief:
      "Find a spot outdoors — anywhere will do. Stand still for exactly 2 minutes. With your eyes closed, catalogue every distinct sound: distance, character, source. Then open your phone's notes app and write your list.",
    proofRequirement: 'Screenshot of your notes list with at least 6 distinct sounds identified.',
    estimatedMinutes: 10,
    xpReward: 30,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner'],
    settingTags: ['Outdoors', 'Nature'],
    costTier: 0,
  },
  {
    title: 'Sky Framing',
    category: 'explore' as const,
    description: "Use a natural or man-made frame to photograph the sky in a way you've never tried.",
    fullBrief:
      "The sky is always there — it's the frame that makes it interesting. Find an opening: a gap in leaves, an alley between buildings, a tunnel entrance. Use it to frame a sky shot that feels deliberate.",
    proofRequirement: 'One photo showing the frame clearly as part of the composition.',
    estimatedMinutes: 10,
    xpReward: 35,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner', 'Friends', 'Family'],
    settingTags: ['Outdoors', 'City', 'Nature'],
    costTier: 0,
  },
  {
    title: 'Street Typography',
    category: 'create' as const,
    description: 'Find 5 different letterforms in your environment. Collect them into one photo.',
    fullBrief:
      'Letters are everywhere outdoors — on signs, painted roads, etched walls, grates. Find 5 unique letterforms and collect them into a single composite photo. Photograph them on the same surface or collage in your photo editor.',
    proofRequirement: 'Composite photo showing 5 distinct environmental letterforms.',
    estimatedMinutes: 25,
    xpReward: 45,
    difficulty: 'Medium' as const,
    difficultyDots: 2,
    crewTags: ['Solo', 'Partner', 'Friends'],
    settingTags: ['City', 'Outdoors'],
    costTier: 0,
  },
  {
    title: 'The Invisible Path',
    category: 'discover' as const,
    description: 'Follow a route that only turns left. Where do you end up? Document the journey.',
    fullBrief:
      'Starting from exactly where you are: walk forward, but only ever turn left when you need to change direction. No right turns. No doubling back. Do this for at least 10 minutes. The constraint creates the adventure.',
    proofRequirement: 'A screenshot of your maps route AND a photo of where you ended up.',
    estimatedMinutes: 30,
    xpReward: 55,
    difficulty: 'Hard' as const,
    difficultyDots: 3,
    crewTags: ['Solo', 'Partner', 'Friends'],
    settingTags: ['Outdoors', 'City', 'Nature'],
    costTier: 0,
  },
  {
    title: 'Coffee Shop Critic',
    category: 'create' as const,
    description: "Order something you've never tried at a local coffee shop and rate it.",
    fullBrief:
      "Pick a coffee shop you haven't been to (or a menu item you've never ordered at one you have). Order it. Rate it on taste, presentation, and vibe out of 10.",
    proofRequirement: 'Photo of the drink/item plus your three ratings.',
    estimatedMinutes: 20,
    xpReward: 30,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner', 'Friends'],
    settingTags: ['Indoors', 'City'],
    costTier: 1,
  },
  {
    title: 'Family Scavenger Dash',
    category: 'discover' as const,
    description: 'Find 5 household or yard items across the colours of the rainbow. Beat the clock.',
    fullBrief:
      "Everyone splits up. Find one item for each colour of the rainbow (or as many as you can) from around the house or yard. Regroup and lay them out in order.",
    proofRequirement: 'Photo of all found items arranged in rainbow order.',
    estimatedMinutes: 30,
    xpReward: 50,
    difficulty: 'Medium' as const,
    difficultyDots: 2,
    crewTags: ['Family', 'Kids Mode'],
    settingTags: ['Indoors', 'Outdoors'],
    costTier: 0,
  },
  {
    title: 'Budget Feast',
    category: 'create' as const,
    description: 'Find a meal under budget at a place none of you have eaten before.',
    fullBrief:
      "Pick a restaurant, food truck, or stall none of you have tried. Order a meal that comes in under your group's budget. Rate the find.",
    proofRequirement: 'Photo of the meal and the receipt (prices may be blurred).',
    estimatedMinutes: 60,
    xpReward: 60,
    difficulty: 'Medium' as const,
    difficultyDots: 2,
    crewTags: ['Partner', 'Friends', 'Family'],
    settingTags: ['City'],
    costTier: 2,
  },
  {
    title: 'Rainy Day Fort',
    category: 'create' as const,
    description: 'Build a blanket fort and take a photo of the whole crew inside.',
    fullBrief:
      'Gather every blanket, cushion, and chair you can find. Build the most ambitious fort your living room allows. Everyone has to fit inside for the photo.',
    proofRequirement: 'Photo of the completed fort with the whole crew inside.',
    estimatedMinutes: 20,
    xpReward: 35,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Family', 'Kids Mode'],
    settingTags: ['Indoors'],
    costTier: 0,
  },
  {
    title: 'No-Limit Adventure',
    category: 'explore' as const,
    description: "Book something nearby you've always wanted to try. Go all in.",
    fullBrief:
      "There's something nearby you've been meaning to try — a class, an experience, a venue. Today's the day. Book it, show up, and go all in.",
    proofRequirement: 'Photo or ticket stub from the experience.',
    estimatedMinutes: 120,
    xpReward: 90,
    difficulty: 'Hard' as const,
    difficultyDots: 3,
    crewTags: ['Solo', 'Partner', 'Friends'],
    settingTags: ['City', 'Nature'],
    costTier: 3,
  },
  {
    title: 'Two-Minute Reset',
    category: 'discover' as const,
    description: "Sit still for 2 minutes. Notice 3 things you've never noticed about this space.",
    fullBrief:
      'Wherever you are right now: sit or stand still for 2 full minutes. No phone. When the time is up, write down 3 things about this exact space you have never consciously noticed before.',
    proofRequirement: 'A short note listing the 3 things you noticed.',
    estimatedMinutes: 15,
    xpReward: 25,
    difficulty: 'Easy' as const,
    difficultyDots: 1,
    crewTags: ['Solo'],
    settingTags: ['Indoors', 'Outdoors', 'City', 'Nature'],
    costTier: 0,
  },
];

/**
 * The single active referral reward rule for v1 (M20, Decisions 3 & 4). The
 * qualifying trigger is the referee's first approved completion (not
 * registration alone, which is trivially abusable), and the reward is XP — the
 * same currency curated missions and peer tasks already grant (one coherent
 * "Rewards" surface, no separate ledger). 50 XP sits in the middle of the
 * curated mission pool (which ranges 25–90, mostly 30–60), so referring a
 * friend who genuinely engages is worth roughly one solid mission — meaningful
 * without dwarfing normal play. No admin UI edits this (Decision 5); ops change
 * it via Prisma Studio. Seeded by a stable synthetic id so re-running the seed
 * updates the same row instead of inserting duplicates.
 */
const REFERRAL_REWARD_RULE = {
  id: 'seed-referral-on-first-completion',
  trigger: 'on_referee_first_completion',
  rewardType: 'xp',
  rewardAmount: 50,
  isActive: true,
};

// ---------------------------------------------------------------------------
// Admin portal (Phase 3) — Permission catalog + system Roles + bootstrap Owner.
// ---------------------------------------------------------------------------

interface PermissionSeed {
  key: string;
  category: string;
  description: string;
}

/**
 * The fixed permission catalog. Dot-namespaced keys (`domain.action`) that mirror
 * the audit-action naming convention. This is the complete, authoritative set —
 * the seed reconciles roles against exactly these keys, so a permission removed
 * here is removed from every role on the next seed run. Chosen key names are a
 * documented Phase-3 judgment call (the plan lists capabilities, not exact keys).
 */
const PERMISSIONS: PermissionSeed[] = [
  // Users
  { key: 'users.view', category: 'Users', description: 'View user accounts and profiles' },
  { key: 'users.edit', category: 'Users', description: 'Edit user profile details' },
  { key: 'users.suspend', category: 'Users', description: 'Suspend or reactivate user accounts' },
  { key: 'users.delete', category: 'Users', description: 'Delete user accounts' },
  { key: 'users.export', category: 'Users', description: 'Export user data' },
  // Proofs / completions
  { key: 'proofs.view', category: 'Proofs', description: 'View submitted mission proofs' },
  { key: 'proofs.review', category: 'Proofs', description: 'Approve or reject proof completions' },
  // Challenges (missions)
  { key: 'challenges.view', category: 'Challenges', description: 'View challenges' },
  { key: 'challenges.create', category: 'Challenges', description: 'Create challenges' },
  { key: 'challenges.edit', category: 'Challenges', description: 'Edit challenges' },
  { key: 'challenges.delete', category: 'Challenges', description: 'Delete challenges' },
  { key: 'challenges.publish', category: 'Challenges', description: 'Publish or archive challenges' },
  { key: 'challenges.approve', category: 'Challenges', description: 'Approve challenges pending review' },
  { key: 'challenges.feature', category: 'Challenges', description: 'Feature or unfeature challenges' },
  // Moderation
  { key: 'moderation.view_queue', category: 'Moderation', description: 'View the moderation queue' },
  { key: 'moderation.remove_content', category: 'Moderation', description: 'Hide or remove reported content' },
  { key: 'moderation.manage_reports', category: 'Moderation', description: 'Triage and resolve reports' },
  { key: 'moderation.take_action', category: 'Moderation', description: 'Warn, suspend, or ban users via moderation' },
  { key: 'moderation.manage_appeals', category: 'Moderation', description: 'Review moderation appeals' },
  // Notification campaigns
  { key: 'campaigns.view', category: 'Campaigns', description: 'View notification campaigns' },
  { key: 'campaigns.create', category: 'Campaigns', description: 'Create or edit notification campaigns' },
  { key: 'campaigns.send', category: 'Campaigns', description: 'Send or schedule notification campaigns' },
  // Website content (CMS)
  { key: 'cms.view', category: 'Content', description: 'View website content' },
  { key: 'cms.edit', category: 'Content', description: 'Create or edit website content' },
  { key: 'cms.publish', category: 'Content', description: 'Publish or unpublish website content' },
  // App config
  { key: 'app_config.view', category: 'Configuration', description: 'View application configuration' },
  { key: 'app_config.manage', category: 'Configuration', description: 'Edit application configuration' },
  // Analytics
  { key: 'analytics.view', category: 'Analytics', description: 'View analytics dashboards' },
  { key: 'analytics.export', category: 'Analytics', description: 'Export analytics data' },
  // Admins & RBAC
  { key: 'admins.view', category: 'Administration', description: 'View admin accounts' },
  { key: 'admins.manage', category: 'Administration', description: 'Create, edit, or suspend admin accounts' },
  { key: 'roles.view', category: 'Administration', description: 'View roles and their permissions' },
  { key: 'roles.manage', category: 'Administration', description: 'Create, edit, or delete roles' },
  { key: 'roles.assign', category: 'Administration', description: 'Assign a role to an admin' },
  { key: 'permissions.assign', category: 'Administration', description: 'Grant or revoke granular permission overrides' },
  // Audit
  { key: 'audit.view', category: 'Audit', description: 'View audit logs' },
];

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

interface RoleSeed {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  mfaRequired: boolean;
  /** Permission keys, or 'ALL' to grant the entire catalog. */
  permissions: string[] | 'ALL';
}

/**
 * System roles. Owner and Super Admin are marked `isSystem` so they can't be
 * deleted or renamed later, and `mfaRequired` so the app layer forces TOTP for
 * the most privileged roles. Role -> permission assignments below are a
 * documented Phase-3 judgment call, biased toward least privilege (e.g.
 * audit-log and RBAC administration stay with Owner/Super Admin only).
 */
const ROLES: RoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Ultimate account with unrestricted access. Cannot be deleted.',
    isSystem: true,
    mfaRequired: true,
    permissions: 'ALL',
  },
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Full administrative access across every surface.',
    isSystem: true,
    mfaRequired: true,
    permissions: 'ALL',
  },
  {
    key: 'user_administrator',
    name: 'User Administrator',
    description: 'Manages end-user accounts.',
    isSystem: false,
    mfaRequired: false,
    permissions: ['users.view', 'users.edit', 'users.suspend', 'users.delete', 'users.export', 'analytics.view'],
  },
  {
    key: 'challenge_manager',
    name: 'Challenge Manager',
    description: 'Authors, approves, and publishes challenges; reviews proofs.',
    isSystem: false,
    mfaRequired: false,
    permissions: [
      'challenges.view',
      'challenges.create',
      'challenges.edit',
      'challenges.delete',
      'challenges.publish',
      'challenges.approve',
      'challenges.feature',
      'proofs.view',
      'proofs.review',
      'analytics.view',
    ],
  },
  {
    key: 'content_moderator',
    name: 'Content Moderator',
    description: 'Handles reports, moderation actions, appeals, and proof review.',
    isSystem: false,
    mfaRequired: false,
    permissions: [
      'moderation.view_queue',
      'moderation.remove_content',
      'moderation.manage_reports',
      'moderation.take_action',
      'moderation.manage_appeals',
      'proofs.view',
      'proofs.review',
      'users.view',
      'users.suspend',
    ],
  },
  {
    key: 'support_agent',
    name: 'Support Agent',
    description: 'Read-mostly access to help users; can view queues but not act on them.',
    isSystem: false,
    mfaRequired: false,
    permissions: ['users.view', 'proofs.view', 'moderation.view_queue', 'campaigns.view', 'analytics.view'],
  },
  {
    key: 'analytics_viewer',
    name: 'Analytics Viewer',
    description: 'Read and export analytics only.',
    isSystem: false,
    mfaRequired: false,
    permissions: ['analytics.view', 'analytics.export'],
  },
  {
    key: 'marketing_manager',
    name: 'Marketing Manager',
    description: 'Manages notification campaigns, website content, and app config.',
    isSystem: false,
    mfaRequired: false,
    permissions: [
      'campaigns.view',
      'campaigns.create',
      'campaigns.send',
      'cms.view',
      'cms.edit',
      'cms.publish',
      'app_config.view',
      'analytics.view',
    ],
  },
];

async function seedPermissions(): Promise<Map<string, string>> {
  const keyToId = new Map<string, string>();
  for (const permission of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: permission.key },
      update: { category: permission.category, description: permission.description },
      create: permission,
    });
    keyToId.set(permission.key, row.id);
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);
  return keyToId;
}

async function seedRoles(permissionIdByKey: Map<string, string>): Promise<void> {
  for (const role of ROLES) {
    const roleRow = await prisma.role.upsert({
      where: { key: role.key },
      update: {
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        mfaRequired: role.mfaRequired,
      },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        mfaRequired: role.mfaRequired,
      },
    });

    const desiredKeys = role.permissions === 'ALL' ? ALL_PERMISSION_KEYS : role.permissions;
    const desiredPermissionIds = new Set(
      desiredKeys.map((key) => {
        const id = permissionIdByKey.get(key);
        if (!id) {
          throw new Error(`Role "${role.key}" references unknown permission "${key}".`);
        }
        return id;
      }),
    );

    // Reconcile: add missing assignments, remove stale ones, so this seed is the
    // authoritative source of each system role's permission set and stays
    // idempotent across re-runs.
    for (const permissionId of desiredPermissionIds) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roleRow.id, permissionId } },
        update: {},
        create: { roleId: roleRow.id, permissionId },
      });
    }
    await prisma.rolePermission.deleteMany({
      where: { roleId: roleRow.id, permissionId: { notIn: Array.from(desiredPermissionIds) } },
    });
  }
  console.log(`Seeded ${ROLES.length} system roles with permission assignments.`);
}

/**
 * Admin-surface password policy (closes security finding W6 for this surface):
 * at least 12 characters and at least 3 of the 4 character classes.
 */
function assertMeetsAdminPasswordPolicy(password: string): void {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length < 12 || classes < 3) {
    throw new Error(
      'ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters and include at least 3 of: ' +
        'lowercase, uppercase, digit, symbol.',
    );
  }
}

/**
 * Bootstraps exactly one Owner admin if none exists. Env-driven (never a
 * hardcoded credential), and idempotent: a pre-existing Owner short-circuits the
 * create, and a concurrent seed run is caught by the AdminUser.email unique
 * constraint (the codebase's established create-if-none race pattern, same as
 * referral-code minting) rather than a lock.
 */
async function bootstrapOwner(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) {
    console.log(
      'Skipping Owner bootstrap: set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD to create the first Owner.',
    );
    return;
  }

  const existingOwners = await prisma.adminUser.count({ where: { role: { key: 'owner' } } });
  if (existingOwners > 0) {
    console.log('Owner bootstrap skipped: an Owner admin already exists.');
    return;
  }

  assertMeetsAdminPasswordPolicy(password);

  const ownerRole = await prisma.role.findUnique({ where: { key: 'owner' } });
  if (!ownerRole) {
    throw new Error('Owner role not found — permissions/roles must be seeded before the Owner.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        displayName: 'Owner',
        status: 'Active',
        roleId: ownerRole.id,
        // Forces a password change and MFA enrollment on first login (Owner role
        // is mfaRequired). The app layer enforces both before privileged access.
        mustChangePassword: true,
      },
    });
    console.log(
      'Bootstrapped Owner admin (see ADMIN_BOOTSTRAP_EMAIL) — must change password + enroll MFA on first login.',
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.log('Owner bootstrap skipped: an admin with that email was created concurrently.');
      return;
    }
    throw error;
  }
}

async function main() {
  for (const mission of MISSIONS) {
    await prisma.mission.upsert({
      where: { title: mission.title },
      update: mission,
      create: mission,
    });
  }
  console.log(`Seeded ${MISSIONS.length} missions.`);

  await prisma.referralRewardRule.upsert({
    where: { id: REFERRAL_REWARD_RULE.id },
    update: {
      trigger: REFERRAL_REWARD_RULE.trigger,
      rewardType: REFERRAL_REWARD_RULE.rewardType,
      rewardAmount: REFERRAL_REWARD_RULE.rewardAmount,
      isActive: REFERRAL_REWARD_RULE.isActive,
    },
    create: REFERRAL_REWARD_RULE,
  });
  console.log('Seeded 1 referral reward rule (on_referee_first_completion, 50 xp).');

  // Admin portal (Phase 3): permission catalog -> system roles -> bootstrap Owner.
  const permissionIdByKey = await seedPermissions();
  await seedRoles(permissionIdByKey);
  await bootstrapOwner();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
