import { NextResponse } from "next/server";
import { getPreset } from "@/server/story-library";
import { chatJSON, llmConfigured, storyModel } from "@/server/llm";
import { SEASON_RESULT_SCHEMA, buildSeasonPrompt, rewriteNodeIds } from "@/server/story-generation";
import type { CastMember, CharacterCard, StoryLocation, StoryPreferences, StoryPlan } from "@/lib/types";
import { STORY_EDITOR_PROMPT_VERSION } from "@/server/story-editor-prompt";

// Fallback roster/locations for the safe-template path — mechanical stand-ins so
// the derived systems (affinity/fragments/locations/achievements) still function
// when no LLM key is configured. Names don't appear in the template prose.
const FALLBACK_CAST: CastMember[] = [
  { id: "cast-a", name: "阿岚", role: "同行者", attribute: "intimacy" },
  { id: "cast-b", name: "阿禾", role: "旧识", attribute: "relationship" },
  { id: "cast-c", name: "阿杉", role: "长辈", attribute: "happiness" },
];
const FALLBACK_LOCATIONS: StoryLocation[] = [
  { id: "loc-a", name: "街角咖啡厅", category: "happiness" },
  { id: "loc-b", name: "河滨步道", category: "happiness" },
  { id: "loc-c", name: "旧书店", category: "intimacy" },
  { id: "loc-d", name: "深夜便利店", category: "intimacy" },
  { id: "loc-e", name: "办公室", category: "career" },
  { id: "loc-f", name: "天台", category: "courage" },
];

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json() as { character?: CharacterCard; preferences?: StoryPreferences };
  const character = body.character;
  if (!character) return NextResponse.json({ error: "缺少角色卡" }, { status: 400 });
  const base = getPreset("test-story");
  if (!base) return NextResponse.json({ error: "安全故事模板不可用" }, { status: 503 });

  // LLM path: full season plan + chapter 1 in a single call.
  if (llmConfigured()) {
    const prompt = buildSeasonPrompt(character, character.promptConstraints ?? []);
    const result = await chatJSON(prompt.system, prompt.user, { model: storyModel(), temperature: 0.9, maxTokens: 8000, schema: SEASON_RESULT_SCHEMA });
    if (result.ok) {
      const story = rewriteNodeIds(result.data.nodes, crypto.randomUUID().slice(0, 8));
      return NextResponse.json({ jobId: crypto.randomUUID(), status: "first_chapter_ready", chapters: result.data.plan.chapters, provider: "bailian", promptVersion: STORY_EDITOR_PROMPT_VERSION, story, plan: result.data.plan, cast: result.data.cast, locations: result.data.locations, preferences: body.preferences });
    }
  }

  // Safe-template fallback: identical to the pre-LLM behavior, plus a plan derived from the template chapters.
  const story = base.nodes.map((node, index) => ({
    ...node,
    id: `custom-${index + 1}`,
    title: index === 0 ? "生活按下暂停键" : node.title,
    scene: index === 0
      ? `${character.name}正在经历：${character.dilemma}。现实没有立刻给出答案，故事会从她已有的资源、关系和限制开始，而不是靠巧合替她解决问题。`
      : node.scene.replace(/林澈/g, character.name),
    choices: node.choices?.map((choice, choiceIndex) => ({ ...choice, id: `custom-${index + 1}-${choiceIndex}` })),
  }));
  const plan: StoryPlan = {
    chapters: 5,
    items: [...new Set(story.map((node) => node.chapter))]
      .filter((chapter) => chapter > 1)
      .slice(-5)
      .map((chapter, index) => {
        const first = story.find((node) => node.chapter === chapter) as (typeof story)[number];
        const synopsis = first.scene.replace(/\s+/g, " ").split(/[。！？]/)[0].slice(0, 40);
        return { chapter: index + 1, title: first.chapterTitle, synopsis };
      }),
  };
  return NextResponse.json({ jobId: crypto.randomUUID(), status: "first_chapter_ready", chapters: 5, provider: "safe-template", promptVersion: STORY_EDITOR_PROMPT_VERSION, story, plan, cast: FALLBACK_CAST, locations: FALLBACK_LOCATIONS, preferences: body.preferences });
}
