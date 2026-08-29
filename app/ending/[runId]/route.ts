import { NextResponse } from "next/server";
import { COACH_PROMPT, COACH_PROMPT_VERSION } from "@/server/coach-prompt";
import type { CoachDigest } from "@/lib/coach-digest";

export const runtime = "nodejs";

type CoachJSON = { observations: { title: string; text: string }[]; quote: string };

/** 从模型返回的文本里尽力提取一份合法 JSON，失败返回 null。 */
function parseCoachJSON(content: string): CoachJSON | null {
  if (!content) return null;
  let text = content.trim();
  // 去掉可能的 markdown 代码围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const attempt = (raw: string): CoachJSON | null => {
    try {
      const obj = JSON.parse(raw) as CoachJSON;
      if (obj && Array.isArray(obj.observations) && obj.observations.length >= 3 && typeof obj.quote === "string") {
        return {
          observations: obj.observations.slice(0, 3).map((item) => ({
            title: typeof item.title === "string" ? item.title : "",
            text: typeof item.text === "string" ? String(item.text).slice(0, 260) : "",
          })),
          quote: String(obj.quote).slice(0, 90),
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const direct = attempt(text);
  if (direct) return direct;
  // 兜底：截取第一个 { 到最后一个 }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return attempt(text.slice(start, end + 1));
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  let digest: CoachDigest | undefined;
  try {
    const body = (await request.json()) as { digest?: CoachDigest };
    digest = body?.digest;
  } catch {
    digest = undefined;
  }
  if (!digest || !Array.isArray(digest.steps) || digest.choiceCount === 0) {
    return NextResponse.json({ runId, fallback: true, reason: "no-data" });
  }
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ runId, fallback: true, reason: "no-dashscope-key" });
  }
  const model = process.env.QWEN_STRUCTURED_MODEL || "qwen-plus";
  const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const payload = {
    model,
    messages: [
      { role: "system", content: COACH_PROMPT },
      {
        role: "user",
        content:
          `请基于以下本局人生数据生成一次 Coach 回望。只使用数据里真实出现的选择与结果，不要编造。\n\n` +
          `玩家走的是「${digest.characterName}」的故事。她的目标：${digest.characterGoal}；她的核心困境：${digest.characterDilemma}。\n` +
          `本局共 ${digest.choiceCount} 次选择。五维净变化：${JSON.stringify(digest.statChanges)}。\n` +
          `逐次选择记录（第几章 · 选项 · 留下的记忆 · 该步五维增减）：\n` +
          digest.steps
            .map((step, index) =>
              `${index + 1}. [第${step.chapter}章] 「${step.choiceLabel}」 —— ${step.memory || "（无记忆）"}${Object.keys(step.deltas).length ? `；五维${JSON.stringify(step.deltas)}` : ""}`
            )
            .join("\n") +
          (digest.endingNodeTitle ? `\n\n最终停在了这一章/节点：「${digest.endingNodeTitle}」。` : ""),
      },
    ],
    temperature: 0.7,
    response_format: { type: "json_object" },
  };
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return NextResponse.json({ runId, fallback: true, reason: `provider-http-${resp.status}` });
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseCoachJSON(content);
    if (!parsed) return NextResponse.json({ runId, fallback: true, reason: "unparseable" });
    return NextResponse.json({ runId, fallback: false, model, promptVersion: COACH_PROMPT_VERSION, result: parsed });
  } catch {
    return NextResponse.json({ runId, fallback: true, reason: "provider-error" });
  }
}