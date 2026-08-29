"use client";
import SystemsDashboard from "@/components/SystemsDashboard";
import { computeSystems } from "@/lib/systems";
import { allRuns, saveRun } from "@/lib/store";
import type { GameRun } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// 成长系统 tab 的共享实现：属性、好感度、记忆碎片、地点、成就与追忆往昔的统一汇总。
// 系统数据全部从 run.choices 派生（lib/systems.ts），此处只负责选线路与触发追忆生成。
export default function SystemsView({ initialRunId }: { initialRunId?: string }) {
  const [runs, setRuns] = useState<GameRun[]>([]);
  const [runId, setRunId] = useState("");
  const [memoryLoading, setMemoryLoading] = useState<number | null>(null);
  useEffect(() => {
    const current = allRuns();
    setRuns(current);
    const prefer = (id?: string) => (id && current.some((r) => r.id === id) ? id : undefined);
    setRunId(prefer(initialRunId) ?? current.find((r) => !r.finished)?.id ?? current[0]?.id ?? "");
  }, [initialRunId]);
  const run = runs.find((r) => r.id === runId);
  const systems = useMemo(() => (run ? computeSystems(run) : null), [run]);

  const viewMemory = async (chapter: number) => {
    if (memoryLoading !== null || !run) return;
    setMemoryLoading(chapter);
    try {
      const response = await fetch("/api/memories/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character: run.character, plan: run.plan, chapter, cast: run.cast, locations: run.locations, memory: run.choices }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "追忆生成失败");
      const next = { ...run, memories: { ...(run.memories ?? {}), [chapter]: { tier: result.tier, text: result.text, at: Date.now() } } };
      saveRun(next);
      setRuns(runs.map((r) => (r.id === next.id ? next : r)));
    } catch { window.alert("这一段的追忆暂时没有准备好，请稍后再试。"); } finally { setMemoryLoading(null); }
  };

  if (runs.length === 0) return <div className="systems-empty"><p>还没有开始任何故事。</p><Link className="primary dark-button" href="/lobby">去角色大厅开始一段平行人生</Link></div>;
  return <>
    <div className="systems-runs">{runs.map((r) => <button type="button" key={r.id} className={r.id === runId ? "active" : ""} onClick={() => setRunId(r.id)}><b>{r.character.name}</b><small>{r.finished ? "已完结" : "进行中"}</small></button>)}</div>
    {run && systems && <><SystemsDashboard run={run} systems={systems} onViewMemory={viewMemory} memoryLoading={memoryLoading} />
      <div className="systems-actions"><Link className="primary dark-button" href={`/play/${run.id}`}>{run.finished ? "回到旅途回望" : "继续故事"}</Link><Link className="pill" href={`/map/${run.id}`}>展开人生地图</Link></div></>}
  </>;
}
