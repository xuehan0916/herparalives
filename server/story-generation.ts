import "server-only";
import { z } from "zod";
import type { CastMember, CharacterCard, ChoiceRecord, StatKey, StoryNode, StoryPreferences, StoryPlan } from "@/lib/types";
import { STAT_KEYS } from "@/lib/types";
import type { SystemsState } from "@/lib/systems";
import { STORY_EDITOR_PROMPT } from "@/server/story-editor-prompt";

// Prompt builders, zod schemas and node-id rewriting for LLM story generation.
// Schemas are strict so that a single malformed field falls back cleanly instead
// of producing a broken chapter at runtime.

const EMPTY_DELTAS = {} as Record<(typeof STAT_KEYS)[number], number>;
// zod4 z.record(keyEnum, value) treats every enum key as required, so values must
// be optional — partial deltas are the norm, and unknown keys are still rejected.
// qwen-family models emit JSON null for absent optional fields, so optional
// fields must be nullish (accept null) and normalized to undefined for the TS types.
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined);
// Attributes only ever grow (0-100); the cost of a choice lives in its `cost`
// text, so deltas are non-negative. Upper cap is loose guidance, not a gate.
// Keys are deliberately loose: qwen-family models occasionally hallucinate a
// 6th key (e.g. "creativity") — better to carry an ignored key through than to
// reject a fully-billed response. Only the five STAT_KEYS are consumed downstream.
const deltasSchema = z
  .record(z.string(), nullable(z.number().int().min(0).max(15)))
  .default(EMPTY_DELTAS);

const affinitySchema = z.object({
  characterId: z.string().min(1),
  amount: z.number().int().min(1).max(5),
});

const fragmentSchema = z.object({
  name: z.string().min(4).max(40),
  text: z.string().min(30).max(200),
});

const choiceSchema = z.object({
  id: z.string().min(1),
  // Caps are deliberately loose: a single field a couple chars over the target
  // (e.g. a 31-char label) used to reject a fully-billed ~170s response and force
  // a second full generation — the cap is quality guidance, not a hard gate.
  label: z.string().min(2).max(36),
  hint: z.string().min(4).max(48),
  gain: z.string().min(4).max(48),
  cost: z.string().min(4).max(48),
  unknown: z.string().min(4).max(48),
  outcome: z.string().min(100).max(1500),
  deltas: deltasSchema,
  memory: z.string().min(4).max(60),
  nextNodeId: nullable(z.string()),
  endsStory: nullable(z.boolean()),
  // Optional affinity gain toward one cast member, and an optional story fragment
  // this choice drops (only on a genuinely key fork — one per chapter at most).
  affinity: nullable(affinitySchema),
  fragment: nullable(fragmentSchema),
});

const castSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(8),
  // Loose: qwen often packs a role + context into one string ("前司创意总监，曾主导…").
  role: z.string().min(2).max(28),
  attribute: z.enum(STAT_KEYS),
});

const locationSchema = z.object({
  id: z.string().min(1),
  // Loose: the model likes to embed the unlock hint in the name ("…（需好感达信赖）").
  name: z.string().min(2).max(24),
  category: z.enum(STAT_KEYS),
  requires: nullable(z.object({ characterId: z.string().min(1), affinityLevel: z.enum(["stranger", "acquainted", "familiar", "trusted", "confidant"]) })),
  extraAttrs: nullable(z.record(z.enum(STAT_KEYS), nullable(z.number().int().min(0).max(100)))),
  ultimate: nullable(z.boolean()),
});

export const nodeSchema = z
  .object({
    id: z.string().min(1),
    chapter: z.number().int().min(1).max(20),
    chapterTitle: z.string().min(2).max(30),
    title: z.string().min(2).max(30),
    scene: z.string().min(200).max(3000),
    dialogue: nullable(z.string()),
    coach: nullable(z.string().min(1).max(500)),
    chapterEnd: nullable(z.boolean()),
    // Choices belong to decision nodes only — pure narration nodes omit the key
    // entirely. Models occasionally emit 2 choices instead of 3 — accept it
    // rather than rejecting a whole run (the UI renders any count).
    choices: nullable(z.array(choiceSchema).min(2).max(3)),
  })
  .strict()
  .refine((node) => !node.chapterEnd || (node.coach?.length ?? 0) >= 20, {
    message: "chapter-ending nodes need a coach of at least 20 characters",
  });

export const planItemSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().min(2).max(30),
  synopsis: z.string().min(20).max(160),
  // Which cast member this chapter centers on (drives 追忆往昔 unlock).
  characterId: nullable(z.string()),
});

export const CHARACTER_CARD_SCHEMA = z.object({
  name: z.string().min(1).max(12),
  background: z.string().min(20).max(200),
  dilemma: z.string().min(8).max(80),
  goal: z.string().min(8).max(80),
  resources: z.array(z.string().min(2).max(30)).min(2).max(5),
});

// Every generated chapter must contain at least one decision node — a chapter
// with zero choices would leave the player reading with nothing to decide.
const hasDecisionNode = (value: { nodes?: Array<{ choices?: unknown[] }>; story?: Array<{ choices?: unknown[] }> }) => {
  const list = value.nodes ?? value.story;
  return (list ?? []).some((node) => (node.choices?.length ?? 0) >= 2);
};

export const SEASON_RESULT_SCHEMA = z
  .object({
    plan: z.object({ chapters: z.literal(5), items: z.array(planItemSchema).length(5) }),
    nodes: z.array(nodeSchema).min(1).max(2),
    cast: z.array(castSchema).length(3),
    locations: z.array(locationSchema).min(6).max(12),
  })
  .refine((value) => value.nodes.every((node) => node.chapter === 1), {
    message: "season generation must only contain chapter-1 nodes",
  })
  .refine(hasDecisionNode, { message: "season chapter 1 must include a decision node" })
  .refine((value) => value.plan.items.every((item) => value.cast.some((member) => member.id === item.characterId)), {
    message: "each plan item must reference a cast member",
  });

export const CHAPTER_RESULT_SCHEMA = z
  .object({
    story: z.array(nodeSchema).min(2).max(3),
  })
  .refine(hasDecisionNode, { message: "each chapter must include a decision node" });

export type CharacterCardInput = {
  name: string;
  situation: string;
  preferences: StoryPreferences;
};

export function buildCharacterCardPrompt(card: CharacterCardInput): { system: string; user: string } {
  const system = [
    `你是《她的平行人生》的角色策划。用户的输入是她本人的现实处境，你必须在完全脱敏的前提下把它改编为一位虚构女性角色的角色卡。`,
    `【脱敏规则】删除姓名、住址、公司名、学校名、具体金额等可识别信息，只保留处境类型与情感结构；不得对用户做心理诊断。`,
    `【命名规则】只有用户明确未提供名字时才自拟一个中文名（2—4字）；否则必须原样保留用户提供的名字。`,
    `【输出规则】只输出 JSON，不要任何其他文字。字段：`,
    `  "name": 角色名(字符串，4字以内)`,
    `  "background": 60—120字，处境与背景的脱敏改编`,
    `  "dilemma": 20—50字，核心困境`,
    `  "goal": 20—50字，角色真正想实现的目标`,
    `  "resources": 数组，3—4 项，每项 4—12 字的可用资源`,
  ].join("\n");
  const user = [
    `用户的处境原文：\n${card.situation}`,
    `用户提供的名字：${card.name || "（未提供）"}`,
    `风格偏好（1—5）：难度 ${card.preferences.difficulty} / 冲突 ${card.preferences.conflict} / 戏剧 ${card.preferences.drama} / 现实 ${card.preferences.realism}`,
    `请只输出 JSON。`,
  ].join("\n");
  return { system, user };
}

// Concrete format examples — qwen-family models follow a literal JSON example far
// more reliably than a prose schema description (observed: without one they collapse
// objects into "chapter: 1, title: …" strings and leak narrative section names like
// 人物互动 / 冲突升级 into keys). Content is placeholder; structure is exact.
const EXAMPLE_PLAN_ITEMS = `[
      { "chapter": 1, "title": "失业的起点", "synopsis": "（第1章冲突与走向，40—80字）", "characterId": "cast-a" },
      { "chapter": 2, "title": "（第2章标题）", "synopsis": "（第2章冲突与走向，40—80字）", "characterId": "cast-b" },
      { "chapter": 3, "title": "（第3章标题）", "synopsis": "（第3章冲突与走向，40—80字）", "characterId": "cast-c" },
      { "chapter": 4, "title": "（第4章标题）", "synopsis": "（第4章冲突与走向，40—80字）", "characterId": "cast-a" },
      { "chapter": 5, "title": "（第5章标题）", "synopsis": "（第5章冲突与走向，40—80字）", "characterId": "cast-b" }
    ]`;

const EXAMPLE_CAST = `[
      { "id": "cast-a", "name": "林薇", "role": "（身份，如：前同事）", "attribute": "career" },
      { "id": "cast-b", "name": "（2—8字）", "role": "（身份，2—20字）", "attribute": "intimacy" },
      { "id": "cast-c", "name": "（2—8字）", "role": "（身份，2—20字）", "attribute": "relationship" }
    ]`;

const EXAMPLE_LOCATIONS = `[
      { "id": "loc-a", "name": "（地点名，如：街角咖啡厅）", "category": "happiness" },
      { "id": "loc-b", "name": "（地点名）", "category": "intimacy" },
      { "id": "loc-c", "name": "（地点名）", "category": "career" },
      { "id": "loc-d", "name": "（探索类地点）", "category": "courage" },
      { "id": "loc-e", "name": "（隐藏地点：需要角色好感或多项属性达标）", "category": "courage", "requires": { "characterId": "cast-a", "affinityLevel": "trusted" } },
      { "id": "loc-f", "name": "（终极场所，可选）", "category": "courage", "ultimate": true }
    ]`;

const EXAMPLE_NODE = `{
    "id": "n1",
    "chapter": 1,
    "chapterTitle": "失业的起点",
    "title": "清晨的焦虑",
    "scene": "（节点正文：350—800字完整场景。先写清时间、地点与人物正在做的事，再写一段有个性的对话或互动，最后写两种真实需求相撞的冲突，把选择推到玩家面前。禁止写 80—150 字的剧情摘要。）",
    "dialogue": "（可选字段：一句有个性的台词）",
    "coach": "（可选字段：Life Coach 镜面回话，仅章末节点出现，20字以上）",
    "chapterEnd": false,
    "choices": [
      {
        "id": "c1",
        "label": "（选项标签，2—36字）",
        "hint": "（该选项的即时线索，4—48字）",
        "gain": "（选择后可能获得的东西，4—48字）",
        "cost": "（选择后需要付出的代价，4—48字，代价只写文案、不写负属性值）",
        "unknown": "（未说破的不确定因素，4—48字）",
        "outcome": "（选后剧情：180—450字完整故事，至少两段，写清行动、回应、代价与下一幕悬念，禁止一两句带过）",
        "deltas": { "career": 6, "happiness": 2 },
        "affinity": { "characterId": "cast-a", "amount": 2 },
        "fragment": { "name": "碎片·（碎片名，4—40字）", "text": "（碎片含义，30—200字）" },
        "memory": "（这一选择值得被记住的一句话，4—60字）"
      },
      { "id": "c2", "label": "…", "hint": "…", "gain": "…", "cost": "…", "unknown": "…", "outcome": "…", "deltas": { }, "affinity": { "characterId": "cast-b", "amount": 3 }, "memory": "…" },
      { "id": "c3", "label": "…", "hint": "…", "gain": "…", "cost": "…", "unknown": "…", "outcome": "…", "deltas": { }, "memory": "…" }
    ]
  }`;

// A pure narration node: advances scene and emotion without offering choices.
const EXAMPLE_PLAIN_NODE = `{
    "id": "n1",
    "chapter": 1,
    "chapterTitle": "失业的起点",
    "title": "清晨的焦虑",
    "scene": "（节点正文：350—800字完整场景。先写清时间、地点与人物正在做的事，再写一段有个性的对话或互动，最后写两种真实需求相撞的冲突。这是纯叙事节点：不提供选项，让事件自然发生、情绪真实推进。禁止写 80—150 字的剧情摘要。）",
    "dialogue": "（可选字段：一句有个性的台词）",
    "chapterEnd": false
  }`;

const SEASON_TASK = [
  `【本次任务】根据角色卡与风格约束，设计一季 5 章的故事大纲、3 位本季人物与地点清单，并完整写出第一章的全部叙事节点。`,
  `【输出规则】只输出 JSON，不要任何其他文字。顶层只允许四个键："plan"、"nodes"、"cast"、"locations"，禁止添加任何其他键。严格按下面的格式示例输出——示例中的"（…）"占位文字只是说明，实际内容必须完整真实。`,
  `{`,
  `  "plan": { "chapters": 5, "items": ${EXAMPLE_PLAN_ITEMS} },`,
  `  "nodes": [ ${EXAMPLE_PLAIN_NODE}, ${EXAMPLE_NODE} ],`,
  `  "cast": ${EXAMPLE_CAST},`,
  `  "locations": ${EXAMPLE_LOCATIONS}`,
  `}`,
  `【本季人物】cast 恰好 3 位与主角命运交织的角色：id（如 "cast-a"）、中文名（2—8字）、身份（2—20字）、关联属性（happiness / intimacy / career / courage / relationship 之一，好感度反哺会加到该属性）。plan.items 每一项必须带 characterId，指向本章的核心角色（可在 3 人间轮换）。`,
  `【地点】locations 给出 6—12 个本季出现的场所：category 为解锁所需属性（happiness=温馨、intimacy=社交、career=工作、courage=探索），属性 ≥ 30 即解锁；隐藏地点可加 requires（需要某角色好感等级）、extraAttrs（多项属性同时达标）或 ultimate（全属性 ≥ 70）。`,
  `【节点类型】节点分两种：`,
  `① 纯叙事节点：没有 choices 字段，用于推进场景、情绪与事件，玩家只阅读不做选择（上面的第一个示例）。`,
  `② 抉择节点：带 choices 字段（2—3 个选项），只出现在真正的关键抉择点：方向选择、代价交换、关系转折、价值观取舍；选项必须构成真实两难，每个选项都有明确的收益与代价（上面的第二个示例）。`,
  `禁止在无关紧要的细节上设置选项——先做哪件事、买不买东西、回不回消息这类都不算关键抉择点。每章必须至少包含 1 个抉择节点，其余为纯叙事节点。`,
  `【类型铁律】每个值必须保持自己的类型：plan.items 的每一项必须是对象；deltas 必须是对象；scene、outcome、label 等必须是字符串。严禁把对象或数组压缩成 "chapter: 1, title: …" 这样的字符串。节点对象只允许示例中的键，禁止把"场景建立""人物互动""冲突升级"等叙事分节名称当作 JSON 键。`,
  `【节点规则】nodes 只写第一章，chapter 全为 1，共 1—2 个节点；最后一个节点 chapterEnd 必须为 true（其余节点为 false）且带 20 字以上的 coach；第一章所有选项禁止出现 nextNodeId 字段（后续章节由系统按你的 plan 续写）；deltas 使用 happiness / intimacy / career / courage / relationship 五个键，值为 0 到 15 的整数（属性只增不减，上限 100；代价只写进 cost 文案，禁止负值），未变化的维度可省略。`,
  `【好感度与碎片】抉择节点的选项可带 "affinity"（对某位本季人物好感度 +1~+5，characterId 必须来自上面的 cast）与 "fragment"（剧情碎片，只在真正推进主线真相的关键选择上掉落，text 写清碎片含义；整章至多 1 枚，不要把每个选项都挂碎片）。`,
  `【正文要求】scene 按编辑规范写 350—800 字完整场景，outcome 写 180—450 字完整选后剧情；禁止缩写或提纲式输出。`,
].join("\n");

export function buildSeasonPrompt(
  character: Pick<CharacterCard, "name" | "background" | "goal" | "dilemma" | "resources">,
  constraints: string[],
): { system: string; user: string } {
  const system = `${STORY_EDITOR_PROMPT}\n\n${SEASON_TASK}`;
  const user = [
    `角色卡：`,
    `- 名字：${character.name}`,
    `- 背景：${character.background}`,
    `- 困境：${character.dilemma}`,
    `- 目标：${character.goal}`,
    `- 资源：${character.resources.join("、")}`,
    ``,
    `风格约束（必须体现在叙事中）：`,
    ...constraints.map((constraint, index) => `${index + 1}. ${constraint}`),
    ``,
    `请只输出 JSON。`,
  ].join("\n");
  return { system, user };
}

export type ChapterInput = {
  character: Pick<CharacterCard, "name" | "background" | "goal" | "dilemma" | "resources">;
  constraints: string[];
  plan: StoryPlan;
  targetChapter: number;
  memorySummary: string;
  lastNode: StoryNode;
  lastChoice: Pick<ChoiceRecord, "choiceLabel" | "memory">;
  lastOutcome: string;
  cast: CastMember[];
  systems: SystemsState;
};

const STAT_LABELS: Record<string, string> = { happiness: "幸福", intimacy: "亲密", career: "事业", courage: "勇气", relationship: "关系" };
const FRAGMENT_LABELS: Record<string, string> = { story: "剧情", memory: "回忆", fate: "命运" };
const ACHIEVEMENT_NAMES: Record<string, string> = {
  socialite: "社交达人", "brave-heart": "勇者之心", "happy-one": "幸福之人", "career-peak": "事业巅峰",
  "memory-keeper": "记忆守护者", explorer: "探索先驱", "bond-master": "羁绊大师",
};

/** One-line-per-system summary of the current derived state, fed into the chapter prompt. */
export function buildSystemsSummary(systems: SystemsState): string {
  const attributes = STAT_KEYS.map((key) => `${STAT_LABELS[key]} ${systems.attributes[key] ?? 0}`).join(" · ");
  const affinity = Object.entries(systems.affinity).map(([, entry]) => `${entry.label}(${entry.value})`).join(" · ");
  const typeCounts = systems.fragments.reduce<Record<string, number>>((acc, fragment) => {
    acc[fragment.type] = (acc[fragment.type] ?? 0) + 1;
    return acc;
  }, {});
  const fragments = ["story", "memory", "fate"].map((type) => `${FRAGMENT_LABELS[type]} ${typeCounts[type] ?? 0}`).join(" · ");
  const locations = Object.entries(systems.locations).filter(([, entry]) => entry.unlocked).length;
  const achievements = systems.achievements.map((id) => ACHIEVEMENT_NAMES[id] ?? id).join("、") || "无";
  return [
    `属性（只增不减，0—100）：${attributes}`,
    `好感度：${affinity || "尚未建立"}`,
    `记忆碎片（共 ${systems.fragments.length} 枚）：${fragments}`,
    `已解锁地点：${locations} 个`,
    `已获成就：${achievements}`,
  ].join("\n");
}

export function buildChapterPrompt(input: ChapterInput): { system: string; user: string } {
  const isFinal = input.targetChapter === input.plan.chapters;
  const system = [
    STORY_EDITOR_PROMPT,
    ``,
    `【本次任务】为已进行到第 ${input.targetChapter - 1} 章的《她的平行人生》续写第 ${input.targetChapter} 章（整季共 ${input.plan.chapters} 章）。本季故事大纲与已发生事件将在用户消息中给出。`,
    `【承接规则】`,
    `1. 用户消息中的"已发生事件"是唯一事实来源：人物身份、关系、工作/经济/家庭状态、时间线必须与之一致，严禁出现与已选路线矛盾的事实（例如玩家拒绝了经济帮助，后续不得默认"她已接受帮助"）。`,
    `2. 开头必须自然衔接上一章结尾的场景与人物情绪，至少引用一次玩家上次选择的记忆内容。`,
    `3. 节点类型：本章输出 2—3 个节点，构成完整章节弧线，其中纯叙事节点（没有 choices 字段，只推进场景与情绪）与抉择节点（带 2—3 个选项）混合，每章必须至少包含 1 个抉择节点；选项只出现在真正的关键抉择点——方向选择、代价交换、关系转折、价值观取舍，禁止在无关紧要的细节上设置选项。最后一个节点 chapterEnd 必须为 true 且带 20 字以上的 coach；若它带选项，其全部选项禁止出现 nextNodeId。`,
    `3b. 选项数值与系统：deltas 只写非负整数（0—15，属性只增不减、上限 100，代价只写进 cost 文案，禁止负值）；选项可带 "affinity"（对某位本季人物好感度 +1~+5，characterId 必须来自用户消息中的本季人物 id，通常给 1—2 个选项即可）与 "fragment"（剧情碎片，只在真正推进主线真相的关键选择上掉落，整章至多 1 枚）。`,
    isFinal
      ? `4. 本章是第 ${input.plan.chapters} 章（最终章）：所有选项禁止出现 nextNodeId；若最后一个节点带选项，其全部选项必须带 "endsStory": true，为整季收束——给出有分量的结局与 Life Coach 回望。`
      : `4. 本章不是最终章：所有选项禁止出现 endsStory 字段。`,
    `5. 输出格式：只输出 JSON，顶层只允许 "story" 一个键，禁止添加其他键。严格按下面的格式示例输出（示例中的"（…）"占位文字只是说明，实际内容必须完整真实；示例的 chapter 为 1，本次输出每个节点的 chapter 必须全部等于 ${input.targetChapter}；第一个示例是纯叙事节点——没有 choices 字段，第二个示例是抉择节点）：`,
    `   { "story": [ ${EXAMPLE_PLAIN_NODE}, ${EXAMPLE_NODE} ] }`,
    `6. 类型铁律：每个值必须保持自己的类型，严禁把对象或数组压缩成 "key: value" 字符串；节点对象只允许示例中的键，禁止把"场景建立""人物互动""冲突升级"等叙事分节名称当作 JSON 键。`,
    `7. 正文要求：scene 写 350—800 字完整场景，outcome 写 180—450 字完整选后剧情；禁止缩写或提纲式输出。`,
  ].join("\n");
  const user = [
    `角色卡：`,
    `- 名字：${input.character.name}`,
    `- 背景：${input.character.background}`,
    `- 困境：${input.character.dilemma}`,
    `- 目标：${input.character.goal}`,
    `- 资源：${input.character.resources.join("、")}`,
    ``,
    `风格约束：`,
    ...input.constraints.map((constraint, index) => `${index + 1}. ${constraint}`),
    ``,
    `整季大纲：`,
    ...input.plan.items.map((item) => `第${item.chapter}章《${item.title}》：${item.synopsis}`),
    ``,
    `本季人物（affinity 只能引用这些 id）：`,
    ...input.cast.map((member) => `- ${member.id}：${member.name}（${member.role}，关联属性：${STAT_LABELS[member.attribute] ?? member.attribute}）`),
    ``,
    `当前状态（写续章时必须延续，不得倒退）：`,
    buildSystemsSummary(input.systems),
    ``,
    `上一章结束处：`,
    `- 场景标题：${input.lastNode.title}`,
    `- 场景结尾：${input.lastNode.scene.slice(-200)}`,
    `- 玩家选择：「${input.lastChoice.choiceLabel}」`,
    `- 选择结果：${input.lastOutcome}`,
    `- 人物记住：${input.lastChoice.memory}`,
    ``,
    `已发生事件（唯一事实来源）：`,
    input.memorySummary || "（暂无）",
    ``,
    `请输出 JSON：{ "story": [ …第 ${input.targetChapter} 章的节点（2—3 个），末节点 chapterEnd 为 true … ] }`,
  ].join("\n");
  return { system, user };
}

export type MemoryInput = {
  character: Pick<CharacterCard, "name" | "background" | "goal" | "dilemma" | "resources">;
  chapter: number;
  chapterTitle: string;
  castMember: CastMember;
  fragments: { name: string; text: string }[];
  happiness: number;
  memorySummary: string;
};

export const MEMORY_RESULT_SCHEMA = z.object({ text: z.string().min(60).max(1200) });

/** 追忆往昔: a chapter's flashback, generated once per unlock and cached in the run. */
export function buildMemoryPrompt(input: MemoryInput): { system: string; user: string } {
  const tier =
    input.happiness >= 90
      ? { label: "完美追忆", length: "350—500 字", extra: "全信息解锁，并给出这一章与终局相连的专属线索" }
      : input.happiness >= 60
        ? { label: "深度追忆", length: "250—400 字", extra: "在基础之上追加一条只有当事人自己才记得的隐藏线索" }
        : input.happiness >= 30
          ? { label: "完整追忆", length: "150—250 字", extra: "在基础之上补充场景细节与人物微表情" }
          : { label: "简略追忆", length: "80—150 字", extra: "只给出最基础的信息" };
  const system = [
    `你是《她的平行人生》的 Life Coach 与追忆记录者。玩家刚完成第 ${input.chapter} 章，你为她整理这段「追忆往昔」——她回望这一章时心里浮现的记忆。`,
    `【深度档位】当前幸福值 ${input.happiness} 对应「${tier.label}」：写 ${tier.length}；${tier.extra}。`,
    `【忠实规则】只能使用用户消息中给出的已发生事件与碎片内容，严禁编造与已发生事件矛盾的事实；不得做心理诊断。`,
    `【口吻】以主角第一人称或贴近主角的第三人称书写，克制、具体、有画面感，不用说教语气。`,
    `【输出规则】只输出 JSON：{ "text": "…" }，不要任何其他文字。`,
  ].join("\n");
  const user = [
    `角色卡：`,
    `- 名字：${input.character.name}`,
    `- 背景：${input.character.background}`,
    `- 困境：${input.character.dilemma}`,
    ``,
    `本章：《${input.chapterTitle}》（第 ${input.chapter} 章）`,
    `本章关联角色：${input.castMember.name}（${input.castMember.role}）`,
    ``,
    `已收集到的记忆碎片：`,
    ...input.fragments.map((fragment) => `- 「${fragment.name}」：${fragment.text}`),
    ``,
    `已发生事件（唯一事实来源）：`,
    input.memorySummary || "（暂无）",
    ``,
    `请只输出 JSON。`,
  ].join("\n");
  return { system, user };
}

/** Rewrites every node/choice id under a per-call prefix; unknown nextNodeId refs (cross-chapter hallucinations) become undefined so the client falls back to linear progression. */
export function rewriteNodeIds(nodes: StoryNode[], callId: string): StoryNode[] {
  const map = new Map<string, string>();
  nodes.forEach((node, index) => map.set(node.id, `g${callId}-c${node.chapter}-n${index + 1}`));
  return nodes.map((node) => ({
    ...node,
    id: map.get(node.id) as string,
    choices: node.choices
      ? node.choices.map((choice, index) => {
          const next = choice.nextNodeId ? map.get(choice.nextNodeId) : undefined;
          return { ...choice, id: `${map.get(node.id)}-ch${index + 1}`, nextNodeId: next };
        })
      : undefined,
  }));
}

export function maxChapterNumber(nodes: StoryNode[]): number {
  return nodes.length ? Math.max(...nodes.map((node) => node.chapter)) : 0;
}

/** One line per chapter: "第2章《…》：选择了「…」→ 记忆摘要"，ordered by chapter. */
export function buildMemorySummary(choices: ChoiceRecord[], nodes: StoryNode[]): string {
  const byNode = new Map(nodes.map((node) => [node.id, node]));
  return choices
    .map((choice) => ({ chapter: byNode.get(choice.nodeId)?.chapter ?? choice.nodeChapter ?? 0, choice }))
    .filter((row) => row.chapter > 0)
    .sort((a, b) => a.chapter - b.chapter)
    .map(({ chapter, choice }) => `第${chapter}章：选择了「${choice.choiceLabel}」→ ${choice.memory.slice(0, 120)}`)
    .join("\n");
}
