import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  for (const mission of MISSIONS) {
    await prisma.mission.upsert({
      where: { title: mission.title },
      update: mission,
      create: mission,
    });
  }
  console.log(`Seeded ${MISSIONS.length} missions.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
