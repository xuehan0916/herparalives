import { NextResponse } from "next/server";
import { chatJSON, llmConfigured, storyModel } from "@/server/llm";
import {
  CHAPTER_RESULT_SCHEMA,
  buildChapterPrompt,
  buildMemorySummary,
  rewriteNodeIds,
} from "@/server/story-generation";
import { computeSystems } from "@/lib/systems";
import type { CastMember, CharacterCard, ChoiceRecord, StoryLocation, StoryNode, StoryPlan, StoryPreferences } from "@/lib/types";

export const maxDuration = 300;

type Body = {
  character?: CharacterCard;
  preferences?: StoryPreferences;
  plan?: StoryPlan;
  targetChapter?: number;
  memory?: ChoiceRecord[];
  lastNode?: StoryNode;
  cast?: CastMember[];
  locations?: StoryLocation[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const { character, plan, targetChapter } = body;
  if (!character || !plan || !plan.items?.length) return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  if (!targetChapter || targetChapter < 2 || targetChapter > plan.chapters) return NextResponse.json({ error: "章节号超出范围" }, { status: 400 });
  const lastNode = body.lastNode;
  if (!lastNode) return NextResponse.json({ error: "缺少上一章节点" }, { status: 400 });
  if (!llmConfigured()) return NextResponse.json({ error: "no_key" }, { status: 503 });

  const memory = body.memory ?? [];
  const cast = body.cast ?? [];
  const lastChoiceRecord = [...memory].reverse().find((record) => record.nodeId === lastNode.id);
  const lastChoiceInNode = lastChoiceRecord
    ? lastNode.choices?.find((choice) => choice.id === lastChoiceRecord.choiceId)
    : undefined;
  const memorySummary = buildMemorySummary(memory, [lastNode]);
  // Replay the choice history through the derived systems so the next chapter
  // knows the current attributes / affinity / fragments / locations / achievements.
  const systems = computeSystems({ choices: memory, cast, locations: body.locations });
  const prompt = buildChapterPrompt({
    character,
    constraints: character.promptConstraints ?? [],
    plan,
    targetChapter,
    memorySummary,
    lastNode,
    lastChoice: lastChoiceRecord
      ? { choiceLabel: lastChoiceRecord.choiceLabel, memory: lastChoiceRecord.memory }
      : { choiceLabel: "（上一章结尾的选择）", memory: "她记得上一章走到这里的选择。" },
    lastOutcome: lastChoiceInNode?.outcome ?? "",
    cast,
    systems,
  });
  const result = await chatJSON(prompt.system, prompt.user, {
    model: storyModel(),
    temperature: 0.9,
    maxTokens: 8000,
    schema: CHAPTER_RESULT_SCHEMA,
  });
  if (!result.ok) return NextResponse.json({ error: "generate_failed" }, { status: 502 });

  const story = rewriteNodeIds(result.data.story, crypto.randomUUID().slice(0, 8));
  // Drop affinity gains toward characters that aren't in the season cast rather
  // than rejecting the whole (already billed) response.
  const castIds = new Set(cast.map((member) => member.id));
  story.forEach((node) => {
    node.choices?.forEach((choice) => {
      if (choice.affinity && !castIds.has(choice.affinity.characterId)) {
        const { affinity: removed, ...rest } = choice;
        Object.assign(choice, rest);
      }
    });
  });
  if (story.some((node) => node.chapter !== targetChapter)) {
    return NextResponse.json({ error: "generate_failed" }, { status: 502 });
  }
  const last = story[story.length - 1];
  // The client only appends what this route returns, so mutating in place is safe.
  // A pure-narration chapter ending (no choices) ends via the coach/回望 button;
  // only force endsStory when the last node actually carries choices.
  last.chapterEnd = true;
  if (last.choices) {
    last.choices =
      targetChapter === plan.chapters
        ? last.choices.map((choice) => ({ ...choice, endsStory: true }))
        : last.choices.map((choice) => {
            const { endsStory: removed, ...rest } = choice;
            return rest;
          });
  }
  return NextResponse.json({ story });
}
