import { NextResponse } from "next/server";
import { COACH_PROMPT, COACH_PROMPT_VERSION } from "@/server/coach-prompt";
import type { CoachDigest } from "@/lib/coach-digest";

export const runtime = "nodejs";

type CoachJSON = {
  observations: { title: string; text: string }[];
  quote: string;
};

/**
 * 从模型返回的文本中尽力提取合法 JSON。
 * Qwen 已要求 json_object，但仍保留这里作为最后一道容错。
 */
function parseCoachJSON(content: string): CoachJSON | null {
  if (!content) return null;

  let text = content.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
  }

  const attempt = (raw: string): CoachJSON | null => {
    try {
      const obj = JSON.parse(raw) as Partial<CoachJSON>;

      if (
        !obj ||
        !Array.isArray(obj.observations) ||
        obj.observations.length < 3 ||
        typeof obj.quote !== "string"
      ) {
        return null;
      }

      const observations = obj.observations
        .slice(0, 3)
        .map((item) => ({
          title:
            item && typeof item.title === "string"
              ? item.title
              : "",
          text:
            item && typeof item.text === "string"
              ? item.text.slice(0, 320)
              : "",
        }));

      if (observations.some((item) => !item.text)) {
        return null;
      }

      return {
        observations,
        quote: obj.quote.slice(0, 90),
      };
    } catch {
      return null;
    }
  };

  const direct = attempt(text);
  if (direct) return direct;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return attempt(text.slice(start, end + 1));
  }

  return null;
}

function buildCoachUserPrompt(digest: CoachDigest): string {
  const stepsText = digest.steps
    .map((step, index) => {
      const positiveStats =
        Object.keys(step.deltas).length > 0
          ? `；本次获得：${JSON.stringify(step.deltas)}`
          : "";

      return [
        `${index + 1}. 第${step.chapter}章`,
        `选择：「${step.choiceLabel}」`,
        `留下的记忆：「${step.memory || "无"}」`,
        positiveStats,
      ].join(" ");
    })
    .join("\n");

  return `
请基于下面这条已经走完的平行人生，生成一次真正的「人生回望」。

重要：不要把任务理解成“总结每一章发生了什么”。

玩家已经知道自己做过这些选择。
她需要看到的是：把这些选择放在一起之后，出现了什么只有回望时才容易看见的东西。

请重点寻找：

1. 跨章节的重复
哪些选择虽然发生在不同章节，但面对的是相似的取舍？

2. 变化或转折
前面的选择与后面的选择之间，是否出现了方向变化、态度变化或代价变化？

3. 隐藏在选择之间的张力
例如稳定与自由、事业与关系、确定性与可能性、照顾别人与你自己的空间等。
只有数据真的支持时才使用，不要强行套标签。

4. 选择与代价之间的关系
不要只说“她选择了A”。
要说明这个选择让她得到了什么，同时让什么东西变得更难。

5. 最后留下一个真正值得继续想的问题
这个问题必须来自本局发生过的具体经历。
不要给建议，不要告诉玩家应该怎么做。

尤其注意：

不要逐章复述。
不要把三段 observation 写成三个剧情摘要。
不要根据五维加分直接推断玩家人格。
不要写“这说明你是……”“你真正想要的是……”“你应该……”。

如果多个选择之间没有形成明确的共同模式，就不要强行制造模式。
宁可指出一个具体而有限的张力，也不要为了显得深刻而编造洞察。

【角色信息】
角色：${digest.characterName}
角色目标：${digest.characterGoal}
角色核心困境：${digest.characterDilemma}

【本局基本信息】
选择次数：${digest.choiceCount}
最终章节：${digest.endingChapter ?? "未知"}
最终节点：${digest.endingNodeTitle ?? "未知"}

【本局五维正向变化】
${JSON.stringify(digest.statChanges)}

【完整选择轨迹】
${stepsText}

现在请输出严格 JSON。

三个 observation 必须分别承担：
- “我注意到的节奏”：跨章节寻找重复、变化或转折，至少引用具体选择；
- “出现的张力”：指出一个真实存在的取舍，以及得到什么、失去什么；
- “还可以带着走的问题”：只提出一个开放问题，把这条平行人生轻轻带回现实。

不要总结“她经历了什么”。
要回答的是：

“把这些选择放在一起看之后，有什么值得重新看一眼？”
`.trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  let digest: CoachDigest | undefined;

  try {
    const body = (await request.json()) as {
      digest?: CoachDigest;
    };

    digest = body?.digest;
  } catch {
    digest = undefined;
  }

  if (
    !digest ||
    !Array.isArray(digest.steps) ||
    digest.choiceCount === 0
  ) {
    return NextResponse.json({
      runId,
      fallback: true,
      reason: "no-data",
    });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      runId,
      fallback: true,
      reason: "no-dashscope-key",
    });
  }

  /**
   * 保持使用 Qwen / DashScope。
   * 如果 Vercel 环境变量中配置了 QWEN_STRUCTURED_MODEL，
   * 就使用队友配置的模型；否则使用 qwen-plus。
   */
  const model =
    process.env.QWEN_STRUCTURED_MODEL || "qwen-plus";

  const endpoint =
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  const payload = {
    model,

    messages: [
      {
        role: "system",
        content: COACH_PROMPT,
      },
      {
        role: "user",
        content: buildCoachUserPrompt(digest),
      },
    ],

    /**
     * Coach 需要有一点洞察，但不能发散得太厉害。
     */
    temperature: 0.65,

    /**
     * Qwen / DashScope 的 OpenAI-compatible 接口支持
     * json_object 输出格式。
     */
    response_format: {
      type: "json_object",
    },
  };

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return NextResponse.json({
        runId,
        fallback: true,
        reason: `provider-http-${resp.status}`,
      });
    }

    const data = (await resp.json()) as {
      choices?: {
        message?: {
          content?: string;
        };
      }[];
    };

    const content =
      data?.choices?.[0]?.message?.content ?? "";

    const parsed = parseCoachJSON(content);

    if (!parsed) {
      return NextResponse.json({
        runId,
        fallback: true,
        reason: "unparseable",
      });
    }

    return NextResponse.json({
      runId,
      fallback: false,
      model,
      promptVersion: COACH_PROMPT_VERSION,
      result: parsed,
    });
  } catch {
    return NextResponse.json({
      runId,
      fallback: true,
      reason: "provider-error",
    });
  }
}
