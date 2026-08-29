import Link from "next/link";

export function AppHeader({ compact = false }: { compact?: boolean }) {
  return <header className={`app-header ${compact ? "compact" : ""}`}><Link className="app-brand" href="/"><span>她</span><b>的平行人生</b></Link><nav><Link href="/lobby">角色大厅</Link><Link href="/systems">成长系统</Link><Link href="/collection">我的图鉴</Link></nav></header>;
}
