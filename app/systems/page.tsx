"use client";
import { AppHeader } from "@/components/AppHeader";
import SystemsView from "@/components/SystemsView";

export default function SystemsPage() {
  return <main className="systems-page"><AppHeader />
    <section className="systems-head"><p className="eyebrow dark">GROWTH SYSTEM</p><h2>成长系统</h2><p>属性只在选择中增长；好感度、记忆碎片、地点与成就随线路推进而解锁。这里汇总一条线路的全部成长。</p></section>
    <SystemsView />
  </main>;
}
