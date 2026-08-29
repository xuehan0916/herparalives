"use client";
import { ACHIEVEMENT_META, isMemoryUnlocked } from "@/lib/systems";
import type { SystemsState } from "@/lib/systems";
import type { GameRun, MemoryTier, StoryLocation } from "@/lib/types";
import { STAT_KEYS } from "@/lib/types";

const statMeta: Record<string, { icon: string; label: string }> = {
  happiness: { icon: "💛", label: "幸福" },
  intimacy: { icon: "🤝", label: "亲密" },
  career: { icon: "💼", label: "事业" },
  courage: { icon: "⚔️", label: "勇气" },
  relationship: { icon: "🌐", label: "关系" },
  wisdom: { icon: "📚", label: "智慧" },
};
const fragmentMeta: Record<string, { icon: string; label: string }> = {
  story: { icon: "📖", label: "剧情碎片" },
  memory: { icon: "💫", label: "回忆碎片" },
  fate: { icon: "🔮", label: "命运碎片" },
};
const tierLabels: Record<MemoryTier, string> = { brief: "简略追忆", full: "完整追忆", deep: "深度追忆", perfect: "完美追忆" };

function locationCondition(location: StoryLocation, run: GameRun): string {
  const parts = [`${statMeta[location.category]?.label ?? location.category} ≥ 30`];
  if (location.requires) {
    const name = run.cast?.find((member) => member.id === location.requires?.characterId)?.name ?? "";
    parts.push(`${name || "某角色"}好感 ≥ 信赖`);
  }
  Object.entries(location.extraAttrs ?? {}).forEach(([key, value]) => { if (value !== undefined) parts.push(`${statMeta[key]?.label ?? key} ≥ ${value}`); });
  if (location.ultimate) parts.push("全属性 ≥ 70");
  return parts.join(" · ");
}

export default function SystemsDashboard(props: { run: GameRun; systems: SystemsState; onViewMemory: (chapter: number) => void; memoryLoading: number | null }) {
  const { run, systems, onViewMemory, memoryLoading } = props;
  return <section className="systems-dashboard">
    <div className="sd-grid">
      <article className="sd-card"><h3>属性 · 你的五维</h3><div className="sd-stats">{STAT_KEYS.map((key) => { const value = systems.attributes[key] ?? 0; return <div className="sd-stat" key={key}><span>{statMeta[key].icon} {statMeta[key].label}</span><div className="sys-bar"><i style={{ width: `${Math.min(100, value)}%` }} /></div><em>{value}</em></div>; })}</div></article>
      <article className="sd-card"><h3>好感度</h3>{(run.cast?.length ?? 0) === 0 ? <p className="muted">本季人物尚未建立。</p> : <div className="sd-affinity">{(run.cast ?? []).map((member) => { const entry = systems.affinity[member.id]; const value = entry?.value ?? 0; return <div className="sd-aff" key={member.id}><span>{member.name}<small>{member.role}</small></span><div className="sys-bar"><i style={{ width: `${Math.min(100, value)}%` }} /></div><em>{entry ? `${entry.label} ${value}` : "陌生 0"}</em></div>; })}</div>}</article>
      <article className="sd-card"><h3>记忆碎片</h3><div className="sd-fragments">{Object.entries(fragmentMeta).map(([type, meta]) => { const count = systems.fragments.filter((fragment) => fragment.type === type).length; return <div className={`sd-frag ${count > 0 ? "has" : ""}`} key={type}>{meta.icon}<b>{meta.label}</b><em>{count} 枚</em></div>; })}<small>集齐任意 3 枚同类型碎片可解锁对应章节的追忆往昔。</small></div></article>
      <article className="sd-card"><h3>地点 · 已探索</h3><div className="sd-locations">{(run.locations ?? []).length === 0 ? <p className="muted">本季地点尚未生成。</p> : (run.locations ?? []).map((location) => { const entry = systems.locations[location.id]; const unlocked = Boolean(entry?.unlocked); return <div className={`sd-loc ${unlocked ? "open" : ""}`} key={location.id}><span>{unlocked ? "📍" : "🔒"} {location.name}</span><small>{unlocked ? "已解锁" : locationCondition(location, run)}</small></div>; })}</div></article>
      <article className="sd-card"><h3>成就</h3><div className="sd-achievements">{Object.entries(ACHIEVEMENT_META).map(([id, meta]) => { const earned = systems.achievements.includes(id as never); return <div className={`sd-ach ${earned ? "earned" : ""}`} key={id}><b>{earned ? "✓" : "○"} {meta.name}</b><small>{meta.description}{earned ? "" : ` · 反哺 ${statMeta[meta.reward]?.label ?? meta.reward} +5`}</small></div>; })}</div></article>
      <article className="sd-card"><h3>追忆往昔</h3><div className="sd-memories">{(run.plan?.items ?? []).map((item) => { const memory = run.memories?.[item.chapter]; const unlock = isMemoryUnlocked(run, item.chapter); const name = run.cast?.find((member) => member.id === item.characterId)?.name ?? ""; return <div className="sd-mem" key={item.chapter}><span>第{item.chapter}章《{item.title}》</span>{memory ? <blockquote>{tierLabels[memory.tier]} · {memory.text}</blockquote> : unlock.unlocked ? <button onClick={() => onViewMemory(item.chapter)} disabled={memoryLoading !== null}>{memoryLoading === item.chapter ? "正在回望…" : `进入追忆往昔${name ? `（${name}）` : ""}`}</button> : <small>{unlock.reason}</small>}</div>; })}</div></article>
    </div>
  </section>;
}
