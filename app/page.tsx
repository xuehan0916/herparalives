import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return <main className="landing">
    <nav className="topbar home-nav"><a className="brand" href="#top"><span>她</span>的平行人生</a><div className="home-links"><Link href="/create">开始游戏</Link><a href="#intro">游戏介绍</a><Link href="/collection">我的图鉴</Link></div></nav>
    <section className="hero" id="top"><div className="hero-image"><Image src="/images/hero.png" alt="一位女性站在人生的多条分岔路线前" fill priority sizes="(max-width: 800px) 100vw, 56vw" /><div className="hero-shade" /></div><div className="hero-copy"><p className="eyebrow">AI VISUAL LIFE SIMULATION</p><h1>如果那天，<br />你选择了<span>另一条路</span>……</h1><p className="lead">描述你此刻真实的处境。AI 会将它脱敏、虚构，编织成一段可以体验、重走与收藏的平行人生。</p><div className="hero-actions"><Link className="primary" href="/create">描述我的处境</Link><Link className="secondary" href="/lobby#sample">试玩她们的故事</Link></div><p className="privacy">人物与未来均为虚构 · 不预测现实人生 · 不保存处境隐私</p></div></section>
    <section className="home-section intro-section" id="intro"><p className="section-no">01</p><div><p className="eyebrow dark">ABOUT THE GAME</p><h2>你没有选择的那条路，<br />让平行人生的她带你体验</h2></div><p>现实中的困境经常被压成一道道选择题。学业、职场、城市选择、亲密关系、婚姻育儿……人生不会重来，但平行人生里，你可以体验、选择、试错、重走。</p></section>
    <section className="atlas-section" id="atlas"><div><p className="eyebrow">YOUR ATLAS</p><h2>每条走过的路，都会留在你的图鉴里</h2></div><Link className="primary" href="/collection">打开我的图鉴</Link></section>
  </main>;
}
