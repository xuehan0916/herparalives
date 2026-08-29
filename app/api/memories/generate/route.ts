import { NextResponse } from "next/server";
import { chatJSON, llmConfigured, storyModel } from "@/server/llm";
import { buildMemoryPrompt, buildMemorySummary, MEMORY_RESULT_SCHEMA } from "@/server/story-generation";
import { computeSystems, isMemoryUnlocked, memoryTierOf } from "@/lib/systems";
import type { CastMember, CharacterCard, ChoiceRecord, StoryLocation, StoryPlan } from "@/lib/types";

export const maxDuration = 60;

type Body = {
  character?: CharacterCard;
  plan?: StoryPlan;
  chapter?: number;
  cast?: CastMember[];
  locations?: StoryLocation[];
  memory?: ChoiceRecord[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const { character, plan, chapter } = body;
  if (!character || !plan || !chapter || chapter < 1 || chapter > plan.chapters) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }
  if (!llmConfigured()) return NextResponse.json({ error: "no_key" }, { status: 503 });

  const cast = body.cast ?? [];
  const memory = body.memory ?? [];
  const input = { choices: memory, cast, locations: body.locations, plan };

  // Server-side gate: the memory only exists when 3 same-type fragments are
  // collected AND the chapter's associated character is at 信赖 or better.
  const unlock = isMemoryUnlocked(input, chapter);
  if (!unlock.unlocked) return NextResponse.json({ error: "该章节的追忆往昔尚未解锁" }, { status: 400 });

  const item = plan.items.find((planItem) => planItem.chapter === chapter);
  const castMember = cast.find((member) => member.id === item?.characterId);
  if (!item || !castMember) return NextResponse.json({ error: "该章节未关联角色" }, { status: 400 });

  const systems = computeSystems(input);
  const happiness = systems.attributes.happiness ?? 0;
  const tier = memoryTierOf(happiness);
  // Feed the fragments of the majority type (the 3+ that unlocked this memory).
  const typeCounts: Record<string, number> = {};
  systems.fragments.forEach((fragment) => { typeCounts[fragment.type] = (typeCounts[fragment.type] ?? 0) + 1; });
  const majorityType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "story";
  const fragments = systems.fragments.filter((fragment) => fragment.type === majorityType).slice(0, 4);

  const prompt = buildMemoryPrompt({
    character,
    chapter,
    chapterTitle: item.title,
    castMember,
    fragments: fragments.map((fragment) => ({ name: fragment.name, text: fragment.text })),
    happiness,
    memorySummary: buildMemorySummary(memory.filter((record) => (record.nodeChapter ?? 0) === chapter), []),
  });
  const result = await chatJSON(prompt.system, prompt.user, {
    model: storyModel(),
    temperature: 0.8,
    maxTokens: 2500,
    schema: MEMORY_RESULT_SCHEMA,
  });
  if (!result.ok) return NextResponse.json({ error: "generate_failed" }, { status: 502 });

  return NextResponse.json({ text: result.data.text, tier: tier.tier, label: tier.label });
}
