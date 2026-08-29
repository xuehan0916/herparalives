"use client";
import { AppHeader } from "@/components/AppHeader";
import SystemsDashboard from "@/components/SystemsDashboard";
import { computeSystems } from "@/lib/systems";
import { getRun, nodesForRun, saveRun } from "@/lib/store";
import type { GameRun, StoryNode } from "@/lib/types";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function MapPage() {
  const id = String(useParams().runId); const router = useRouter(); const [run, setRun] = useState<GameRun>();
  const [memoryLoading, setMemoryLoading] = useState<number | null>(null);
  useEffect(() => setRun(getRun(id)), [id]);
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
      saveRun(next); setRun(next);
    } catch { window.alert("这一段的追忆暂时没有准备好，请稍后再试。"); } finally { setMemoryLoading(null); }
  };
  if (!run) return null;
  const nodes = nodesForRun(run);
  const routeIds = run.visitedNodeIds?.length ? run.visitedNodeIds : nodes.slice(0, run.currentIndex + 1).map((node) => node.id);
  const routeNodes = routeIds.map((nodeId) => nodes.find((node) => node.id === nodeId)).filter((node): node is StoryNode => Boolean(node));
  const rewind = (index: number) => {
    const target = routeNodes[index]; if (!target) return;
    const priorIds = new Set(routeIds.slice(0, index));
    const next = { ...run, currentIndex: nodes.findIndex((node) => node.id === target.id), currentNodeId: target.id, visitedNodeIds: routeIds.slice(0, index + 1), choices: run.choices.filter((choice) => priorIds.has(choice.nodeId)), branch: run.branch + 1, finished: false, updatedAt: Date.now() };
    saveRun(next); router.push(`/play/${id}`);
  };
  return <main className="map-page"><AppHeader />
    <section className="map-head"><p className="eyebrow dark">PARALLEL ROUTES · LINE {run.branch}</p><h2>{run.character.name}展开过的人生线路</h2><p>地图只展示这条线路真正抵达过的节点。回到关键站点后，新的选择会建立另一条连续线路。</p></section>
    <section className="branch-map">{routeNodes.map((node, index) => { const record = run.choices.find((item) => item.nodeId === node.id); return <article className="route-stage reached" key={node.id}><header><span>{index === 0 ? "序" : String(index).padStart(2,"0")}</span><div><small>{node.chapterTitle}</small><h3>{node.title}</h3></div>{record && index < routeNodes.length - 1 && <button onClick={() => rewind(index)}>从这里再走一次</button>}</header><div className="route-fan">{(node.choices ?? []).map((choice, choiceIndex) => { const chosen = record?.choiceId === choice.id; return <div className={`route-option ${chosen ? "chosen" : "unchosen"}`} key={choice.id}><i>{String.fromCharCode(65 + choiceIndex)}</i><strong>{choice.label}</strong><small>{chosen ? "你走过这里" : "未探索的平行方向"}</small></div>; })}</div></article>; })}</section>
    {systems && <SystemsDashboard run={run} systems={systems} onViewMemory={viewMemory} memoryLoading={memoryLoading} />}
    <div className="map-actions"><button className="primary dark-button" onClick={() => router.push(run.finished ? `/ending/${id}` : `/play/${id}`)}>{run.finished ? "回到旅途回望" : "返回当前章节"}</button></div>
  </main>;
}
