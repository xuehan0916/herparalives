"use client";
import { AppHeader } from "@/components/AppHeader";
import { getRun, nodesForRun, saveRun } from "@/lib/store";
import type { GameRun, StoryNode } from "@/lib/types";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function MapPage() {
  const id = String(useParams().runId); const router = useRouter(); const [run, setRun] = useState<GameRun>();
  useEffect(() => setRun(getRun(id)), [id]);
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
    <section className="map-head"><p className="eyebrow dark">PARALLEL ROUTES · LINE {run.branch}</p><h2>{run.character.name}展开过的人生线路</h2><p>地图只展示这条线路真正抵达过的节点。回到关键站点后，新的选择会建立另一条连续线路。你的属性、好感、碎片、地点与成就在「成长系统」页查看。</p></section>
    <section className="branch-map">{routeNodes.map((node, index) => { const record = run.choices.find((item) => item.nodeId === node.id); return <article className="route-stage reached" key={node.id}><header><span>{index === 0 ? "序" : String(index).padStart(2,"0")}</span><div><small>{node.chapterTitle}</small><h3>{node.title}</h3></div>{record && index < routeNodes.length - 1 && <button onClick={() => rewind(index)}>从这里再走一次</button>}</header><div className="route-fan">{(node.choices ?? []).map((choice, choiceIndex) => { const chosen = record?.choiceId === choice.id; return <div className={`route-option ${chosen ? "chosen" : "unchosen"}`} key={choice.id}><i>{String.fromCharCode(65 + choiceIndex)}</i><strong>{choice.label}</strong><small>{chosen ? "你走过这里" : "未探索的平行方向"}</small></div>; })}</div></article>; })}</section>
    <div className="map-actions"><Link href={`/systems/${id}`} className="pill">查看成长系统</Link><button className="primary dark-button" onClick={() => router.push(run.finished ? `/ending/${id}` : `/play/${id}`)}>{run.finished ? "回到旅途回望" : "返回当前章节"}</button></div>
  </main>;
}
