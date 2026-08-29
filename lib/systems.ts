// Deterministic game-system derivation. Everything below is recomputed from
// `run.choices` in order, so a rewind (truncating choices) automatically stays
// consistent — no snapshots to keep in sync. All state is strictly derived:
// attributes only grow (0-100), the cost of a choice lives in its `cost` text.

import type { AffinityLevel, AchievementId, CastMember, ChoiceRecord, Fragment, GameRun, MemoryTier, StatKey, StoryLocation } from "./types";
import { STAT_KEYS } from "./types";

const MAX_ATTRIBUTE = 100;

// --- spec constants ---------------------------------------------------------

const AFFINITY_LEVELS: Array<{ min: number; level: AffinityLevel; label: string }> = [
  { min: 80, level: "confidant", label: "挚友" },
  { min: 60, level: "trusted", label: "信赖" },
  { min: 40, level: "familiar", label: "熟悉" },
  { min: 20, level: "acquainted", label: "认识" },
  { min: 0, level: "stranger", label: "陌生" },
];

export const affinityLevelOf = (value: number): { level: AffinityLevel; label: string } =>
  AFFINITY_LEVELS.find((entry) => value >= entry.min) ?? AFFINITY_LEVELS[AFFINITY_LEVELS.length - 1];

const intimacyMultiplier = (intimacy: number) =>
  intimacy >= 90 ? 1.8 : intimacy >= 60 ? 1.5 : intimacy >= 30 ? 1.2 : 1.0;

const affinityCap = (relationship: number) =>
  relationship >= 90 ? 120 : relationship >= 60 ? 100 : relationship >= 30 ? 80 : 60;

// 命运碎片 threshold rules.
const FATE_RULES: Array<{ name: string; attribute: StatKey; threshold: number; text: string }> = [
  { name: "命运碎片·突破", attribute: "courage", threshold: 40, text: "当勇气足够直面未知，命运的门第一次被推开。" },
  { name: "命运碎片·觉醒", attribute: "intimacy", threshold: 70, text: "当亲近成为一种力量，被遮蔽的记忆开始苏醒。" },
  { name: "命运碎片·羁绊", attribute: "relationship", threshold: 50, text: "当关系编织成网，一条被遗忘的线索浮现。" },
];

// 成就条件 + 反哺（解锁时对应属性 +5）。
const ACHIEVEMENTS: Array<{
  id: AchievementId;
  name: string;
  reward: StatKey;
  test: (state: MutableState) => boolean;
}> = [
  { id: "socialite", name: "社交达人", reward: "relationship", test: (s) => s.attributes.relationship >= 70 && s.attributes.intimacy >= 60 },
  { id: "brave-heart", name: "勇者之心", reward: "courage", test: (s) => s.attributes.courage >= 80 && s.attributes.career >= 40 },
  { id: "happy-one", name: "幸福之人", reward: "happiness", test: (s) => s.attributes.happiness >= 80 && Object.values(s.affinity).filter((a) => a.level === "confidant").length >= 2 },
  { id: "career-peak", name: "事业巅峰", reward: "career", test: (s) => s.attributes.career >= 90 },
  { id: "memory-keeper", name: "记忆守护者", reward: "happiness", test: (s) => s.fragments.length >= 8 },
  { id: "explorer", name: "探索先驱", reward: "courage", test: (s) => Object.values(s.locations).filter((l) => l.unlocked).length >= 10 },
  { id: "bond-master", name: "羁绊大师", reward: "intimacy", test: (s) => Object.values(s.affinity).filter((a) => ["trusted", "confidant"].includes(a.level)).length >= 3 },
];

const BASE_LOCATION_THRESHOLD = 30;
const ULTIMATE_ATTRIBUTE = 70;

// --- state shape ------------------------------------------------------------

type AffinityEntry = { value: number; level: AffinityLevel; label: string };
type LocationEntry = { unlocked: boolean; unlockedAt?: number };

type MutableState = {
  attributes: Record<StatKey, number>;
  affinity: Record<string, AffinityEntry>;
  fragments: Fragment[];
  locations: Record<string, LocationEntry>;
  achievements: AchievementId[];
  grantedFates: Set<string>;
  allAttrBonusApplied: boolean;
};

export type SystemsState = {
  attributes: Record<StatKey, number>;
  affinity: Record<string, AffinityEntry>;
  fragments: Fragment[];
  locations: Record<string, LocationEntry>;
  achievements: AchievementId[];
};

export const ACHIEVEMENT_META: Record<AchievementId, { name: string; reward: StatKey; description: string }> = {
  socialite: { name: "社交达人", reward: "relationship", description: "关系 ≥ 70 · 亲密 ≥ 60" },
  "brave-heart": { name: "勇者之心", reward: "courage", description: "勇气 ≥ 80 · 事业 ≥ 40" },
  "happy-one": { name: "幸福之人", reward: "happiness", description: "幸福 ≥ 80 · 挚友 ≥ 2 人" },
  "career-peak": { name: "事业巅峰", reward: "career", description: "事业 ≥ 90" },
  "memory-keeper": { name: "记忆守护者", reward: "happiness", description: "收集碎片 ≥ 8 枚" },
  explorer: { name: "探索先驱", reward: "courage", description: "解锁地点 ≥ 10 个" },
  "bond-master": { name: "羁绊大师", reward: "intimacy", description: "好感度信赖 ≥ 3 人" },
};

// --- pure helpers -----------------------------------------------------------

const growAttribute = (attributes: Record<StatKey, number>, key: StatKey, amount: number) => {
  if (!key || amount <= 0) return;
  attributes[key] = Math.min(MAX_ATTRIBUTE, attributes[key] + amount);
};

export type SystemsInput = {
  choices: ChoiceRecord[];
  cast?: CastMember[];
  locations?: StoryLocation[];
};

const seed = (run: SystemsInput): MutableState => {
  const attributes = {} as Record<StatKey, number>;
  (["happiness", "intimacy", "career", "courage", "relationship", "wisdom"] as StatKey[]).forEach((key) => { attributes[key] = 0; });
  const affinity: Record<string, AffinityEntry> = {};
  (run.cast ?? []).forEach((member) => { affinity[member.id] = { value: 0, level: "stranger", label: "陌生" }; });
  const locations: Record<string, LocationEntry> = {};
  (run.locations ?? []).forEach((location) => { locations[location.id] = { unlocked: false }; });
  return { attributes, affinity, fragments: [], locations, achievements: [], grantedFates: new Set(), allAttrBonusApplied: false };
};

const refreshAffinityEntry = (entry: AffinityEntry) => {
  const tier = affinityLevelOf(entry.value);
  entry.level = tier.level;
  entry.label = tier.label;
};

const locationUnlocked = (state: MutableState, location: StoryLocation): boolean => {
  const attrs = state.attributes;
  if (attrs[location.category] < BASE_LOCATION_THRESHOLD) return false;
  if (location.ultimate) return STAT_KEYS.every((key) => attrs[key] >= ULTIMATE_ATTRIBUTE);
  if (location.extraAttrs) {
    const unmet = Object.entries(location.extraAttrs).some(([key, value]) => attrs[key as StatKey] < (value ?? 0));
    if (unmet) return false;
  }
  if (location.requires) {
    const entry = state.affinity[location.requires.characterId];
    if (!entry) return false;
    const requiredMin = AFFINITY_LEVELS.find((tier) => tier.level === location.requires?.affinityLevel)?.min ?? 0;
    if (entry.value < requiredMin) return false;
  }
  return true;
};

/** Apply one choice's effects to the running state, in order. */
function applyChoice(state: MutableState, run: SystemsInput, choice: ChoiceRecord, chapterOf: (record: ChoiceRecord) => number) {
  const chapter = chapterOf(choice);
  // 1. Attributes only grow, capped at 100 — legacy negative deltas clamp to no-op.
  Object.entries(choice.deltas).forEach(([key, delta]) => { growAttribute(state.attributes, key as StatKey, delta ?? 0); });

  // 2. Affinity: base gain × intimacy multiplier, capped by relationship; level-up 反哺 +3.
  if (choice.affinity) {
    const member = (run.cast ?? []).find((cast) => cast.id === choice.affinity?.characterId);
    if (member) {
      const entry = state.affinity[member.id] ?? { value: 0, level: "stranger" as AffinityLevel, label: "陌生" };
      const before = entry.value;
      const gained = Math.floor((choice.affinity.amount ?? 0) * intimacyMultiplier(state.attributes.intimacy));
      entry.value = Math.min(affinityCap(state.attributes.relationship), entry.value + gained);
      refreshAffinityEntry(entry);
      state.affinity[member.id] = entry;
      // 反哺机制: each level tier crossed (20/40/60/80 boundary) → associated attribute +3 and a 回忆碎片 drops.
      if (Math.floor(before / 20) < Math.floor(entry.value / 20)) {
        growAttribute(state.attributes, member.attribute, 3);
        state.fragments.push({ id: `mem-${choice.at}-${member.id}`, type: "memory", name: `「${member.name}」的${entry.label}`, text: `与「${member.name}」（${member.role}）的羁绊进入了「${entry.label}」，一段属于她的背景浮现。`, chapter, at: choice.at });
      }
    }
  }

  // 3. Story fragment dropped by the choice.
  if (choice.fragment) {
    state.fragments.push({ id: `frag-${choice.at}`, type: "story", name: choice.fragment.name, text: choice.fragment.text, chapter, at: choice.at });
  }

  // 4. Fate fragments unlock once an attribute first crosses its threshold.
  FATE_RULES.forEach((rule) => {
    if (!state.grantedFates.has(rule.name) && state.attributes[rule.attribute] >= rule.threshold) {
      state.grantedFates.add(rule.name);
      state.fragments.push({ id: `fate-${rule.name}`, type: "fate", name: rule.name, text: rule.text, chapter, at: choice.at });
    }
  });

  // 5. Locations.
  (run.locations ?? []).forEach((location) => {
    const entry = state.locations[location.id];
    if (!entry.unlocked && locationUnlocked(state, location)) {
      entry.unlocked = true;
      entry.unlockedAt = choice.at;
    }
  });

  // 6. Achievements — loop until stable because rewards can cascade.
  let progressed = true;
  while (progressed) {
    progressed = false;
    ACHIEVEMENTS.forEach((achievement) => {
      if (state.achievements.includes(achievement.id) || !achievement.test(state)) return;
      state.achievements.push(achievement.id);
      growAttribute(state.attributes, achievement.reward, 5);
      progressed = true;
    });
    if (state.achievements.length >= 3 && !state.allAttrBonusApplied) {
      state.allAttrBonusApplied = true;
      (Object.keys(state.attributes) as StatKey[]).forEach((key) => growAttribute(state.attributes, key, 3));
      progressed = true;
    }
  }
}

/**
 * Recompose the whole derived game state from a run's choice history.
 * Deterministic and order-sensitive — safe to call on every render.
 */
export function computeSystems(run: SystemsInput): SystemsState {
  const state = seed(run);
  run.choices.forEach((choice) => applyChoice(state, run, choice, (record) => record.nodeChapter ?? 0));
  const { grantedFates: _grantedFates, allAttrBonusApplied: _bonus, ...result } = state;
  void _grantedFates; void _bonus;
  return result;
}

/** 追忆往昔 depth tier by current happiness. */
export function memoryTierOf(happiness: number): { tier: MemoryTier; label: string; prompt: string } {
  if (happiness >= 90) return { tier: "perfect", label: "完美追忆", prompt: "全信息解锁，含专属结局线索" };
  if (happiness >= 60) return { tier: "deep", label: "深度追忆", prompt: "包含隐藏线索" };
  if (happiness >= 30) return { tier: "full", label: "完整追忆", prompt: "包含细节" };
  return { tier: "brief", label: "简略追忆", prompt: "只给基础信息" };
}

export function isMemoryUnlocked(run: SystemsInput & { plan?: GameRun["plan"] }, chapter: number): { unlocked: boolean; reason: string } {
  const state = computeSystems(run);
  const item = run.plan?.items.find((plan) => plan.chapter === chapter);
  if (!item?.characterId) return { unlocked: false, reason: "本章尚未关联角色" };
  const affinity = state.affinity[item.characterId];
  if (!affinity) return { unlocked: false, reason: "本章角色尚未出场" };
  if (affinity.value < 60) {
    return { unlocked: false, reason: `「${run.cast?.find((c) => c.id === item.characterId)?.name ?? ""}」好感需达信赖` };
  }
  const typeCounts: Record<string, number> = {};
  state.fragments.forEach((fragment) => { typeCounts[fragment.type] = (typeCounts[fragment.type] ?? 0) + 1; });
  if (!Object.values(typeCounts).some((count) => count >= 3)) return { unlocked: false, reason: "需集齐 3 枚同类型碎片" };
  return { unlocked: true, reason: "已解锁" };
}
