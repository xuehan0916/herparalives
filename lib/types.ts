// The five display attributes. Deltas only ever grow these (0-100 cap); the cost
// of a choice lives in its `cost` text, not in negative values. "wisdom" survives
// as a legacy key purely so old preset story data still type-checks.
export const STAT_KEYS = ["happiness", "intimacy", "career", "courage", "relationship"] as const;
export type StatKey = (typeof STAT_KEYS)[number] | "wisdom";

export type StatDelta = Partial<Record<StatKey, number>>;

export type AffinityLevel = "stranger" | "acquainted" | "familiar" | "trusted" | "confidant";

/** A named character the player builds affinity with — defined by the season prompt. */
export type CastMember = { id: string; name: string; role: string; attribute: StatKey };

/** Affinity gained toward a cast member by picking a choice. */
export type StoryAffinity = { characterId: string; amount: number };

/** A story fragment dropped by a key choice (剧情碎片). */
export type StoryFragment = { name: string; text: string };

export type FragmentType = "story" | "memory" | "fate";

export type Fragment = { id: string; type: FragmentType; name: string; text: string; chapter: number; at: number };

/** Location category = the attribute that unlocks it (温馨/社交/工作/探索). */
export type LocationCategory = (typeof STAT_KEYS)[number];

export type StoryLocation = {
  id: string;
  name: string;
  category: LocationCategory;
  /** Hidden/composite locations need more than the base category threshold. */
  requires?: { characterId: string; affinityLevel: AffinityLevel };
  extraAttrs?: Partial<Record<StatKey, number>>;
  /** 终极场所: every attribute >= 70. */
  ultimate?: boolean;
};

export type MemoryTier = "brief" | "full" | "deep" | "perfect";

export type MemoryRecord = { tier: MemoryTier; text: string; at: number };

export type AchievementId = "socialite" | "brave-heart" | "happy-one" | "career-peak" | "memory-keeper" | "explorer" | "bond-master";

export type StoryChoice = {
  id: string;
  label: string;
  hint: string;
  gain: string;
  cost: string;
  unknown: string;
  outcome: string;
  deltas: StatDelta;
  memory: string;
  nextNodeId?: string;
  endsStory?: boolean;
  /** Optional affinity gain toward one cast member. */
  affinity?: StoryAffinity;
  /** Optional story fragment this choice drops. */
  fragment?: StoryFragment;
};

export type StoryNode = {
  id: string;
  chapter: number;
  chapterTitle: string;
  title: string;
  scene: string;
  dialogue?: string;
  coach?: string;
  chapterEnd?: boolean;
  illustration?: string;
  // Pure narration nodes have no choices — decisions only appear at key forks.
  choices?: StoryChoice[];
};

export type Preset = {
  id: string;
  name: string;
  age: number;
  portrait: number;
  theme: string;
  tagline: string;
  situation: string;
  color: string;
  nodes: StoryNode[];
  /** Systems data for preset runs that showcase affinity/locations/追忆往昔. */
  plan?: StoryPlan;
  cast?: CastMember[];
  locations?: StoryLocation[];
};

export type CharacterCard = {
  id: string;
  name: string;
  age?: number;
  portrait: number;
  background: string;
  goal: string;
  resources: string[];
  dilemma: string;
  isCustom: boolean;
  storyPreferences?: StoryPreferences;
  promptConstraints?: string[];
};

export type StoryPreferences = {
  difficulty: number;
  conflict: number;
  drama: number;
  realism: number;
};

export type StoryPlanItem = { chapter: number; title: string; synopsis: string; characterId?: string };

export type StoryPlan = { chapters: number; items: StoryPlanItem[] };

export type ChoiceRecord = {
  nodeId: string;
  choiceId: string;
  choiceLabel: string;
  memory: string;
  deltas: StatDelta;
  at: number;
  /** Chapter the node belonged to — lets the derived systems tag fragments. */
  nodeChapter?: number;
  affinity?: StoryAffinity;
  fragment?: StoryFragment;
};

export type GameRun = {
  id: string;
  character: CharacterCard;
  presetId?: string;
  story: StoryNode[];
  plan?: StoryPlan;
  currentIndex: number;
  currentNodeId?: string;
  visitedNodeIds?: string[];
  choices: ChoiceRecord[];
  branch: number;
  createdAt: number;
  updatedAt: number;
  finished: boolean;
  cardQuote?: string;
  cardSavedAt?: number;
  /** Named characters from the season generation (affinity targets). */
  cast?: CastMember[];
  /** Location roster from the season generation (unlock state is derived). */
  locations?: StoryLocation[];
  /** Cached 追忆往昔 texts, keyed by chapter. */
  memories?: Partial<Record<number, MemoryRecord>>;
};
