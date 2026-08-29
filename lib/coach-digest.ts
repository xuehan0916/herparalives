import type { GameRun, StatKey } from "./types";

const statLabels: Record<StatKey, string> = { career: "事业", wisdom: "智慧", happiness: "幸福", relationship: "关系", courage: "勇气" };

/** 每一步选择的本局真实痕迹，供 Coach 引用具体选择。 */
export type CoachDigestStep = {
  chapter: number;
  choiceLabel: string;
  memory: string;
  deltas: Record<string, number>;
};

/** 喂给 Coach prompt 的本局数据摘要。只包含 GameRun 中真实存在的字段。 */
export type CoachDigest = {
  characterName: string;
  characterGoal: string;
  characterDilemma: string;
  presetId?: string;
  choiceCount: number;
  endingChapter?: number;
  endingNodeTitle?: string;
  /** 各五维的本局净变化（未发生的维度不列出）。 */
  statChanges: Record<string, number>;
  steps: CoachDigestStep[];
};

export function buildCoachDigest(run: GameRun): CoachDigest {
  const statChanges: Record<string, number> = {};
  for (const choice of run.choices) {
    for (const key of Object.keys(choice.deltas) as StatKey[]) {
      const value = choice.deltas[key];
      if (value) statChanges[statLabels[key]] = (statChanges[statLabels[key]] || 0) + value;
    }
  }
  const steps: CoachDigestStep[] = run.choices.map((choice) => {
    const node = run.story?.find((item) => item.id === choice.nodeId);
    const deltas: Record<string, number> = {};
    for (const key of Object.keys(choice.deltas) as StatKey[]) {
      const value = choice.deltas[key];
      if (value) deltas[statLabels[key]] = value;
    }
    return {
      chapter: node?.chapter ?? 0,
      choiceLabel: choice.choiceLabel,
      memory: choice.memory,
      deltas,
    };
  });
  const endingNode = steps.length ? run.story?.find((item) => item.id === run.choices[run.choices.length - 1].nodeId) : undefined;
  return {
    characterName: run.character.name,
    characterGoal: run.character.goal,
    characterDilemma: run.character.dilemma,
    presetId: run.presetId,
    choiceCount: run.choices.length,
    endingChapter: endingNode?.chapter,
    endingNodeTitle: endingNode?.title,
    statChanges,
    steps,
  };
}