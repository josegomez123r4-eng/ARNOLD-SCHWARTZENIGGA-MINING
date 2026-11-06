import { useEffect, useMemo, useState } from 'react'
import WebApp from '@twa-dev/sdk'
import { Activity, ArrowUpRight, Check, ChevronRight, Coins, Flame, Gift, Pickaxe, ShieldCheck, Trophy, Wallet, Zap } from 'lucide-react'

const CYCLE_SECONDS = 86400
const BASE_REWARD = 5
type Tab = 'mine' | 'leaderboard' | 'profile'
function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  return { hours: Math.floor(safe / 3600).toString().padStart(2, '0'), minutes: Math.floor((safe % 3600) / 60).toString().padStart(2, '0'), secs: Math.floor(safe % 60).toString().padStart(2, '0') }
}
export default function App() {
  const [tab, setTab] = useState<Tab>('mine')
  const [cycleStartedAt, setCycleStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [claimed, setClaimed] = useState(0)
  const [pending, setPending] = useState(0)
  const [walletConnected, setWalletConnected] = useState(false)
  useEffect(() => {
    try { WebApp.ready(); WebApp.expand(); WebApp.setHeaderColor('#090909'); WebApp.setBackgroundColor('#090909') } catch { /* Browser preview */ }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const elapsed = cycleStartedAt ? Math.floor((now - cycleStartedAt) / 1000) : 0
  const remaining = cycleStartedAt ? Math.max(0, CYCLE_SECONDS - elapsed) : 0
  const miningComplete = Boolean(cycleStartedAt && remaining === 0)
  const miningActive = Boolean(cycleStartedAt && remaining > 0)
  const progress = cycleStartedAt ? Math.min(100, elapsed / CYCLE_SECONDS * 100) : 0
  const time = useMemo(() => formatTime(remaining), [remaining])
  function startMining() { if (!cycleStartedAt && pending === 0) setCycleStartedAt(Date.now()) }
  function finishCycle() { if (!miningComplete) return; setPending(value => value + BASE_REWARD); setCycleStartedAt(null) }
  function claimRewards() { if (pending <= 0) return; setClaimed(value => value + pending); setPending(0) }
  function connectWallet() { setWalletConnected(true) }
  return <main className="app-shell">
    <div className="glow glow-a"/><div className="glow glow-b"/>
    <header className="topbar"><div className="brand"><div className="brand-symbol"><Flame size={21} fill="currentColor"/></div><div><div className="brand-name">ARNOLD</div><div className="brand-sub">SCHWARTZENIGGA MINING</div></div></div><div className="live-pill"><span/> MINI APP</div></header>
    <div className="content">
      {tab === 'mine' && <>
        <section className="hero"><div className="overline"><span/> THE DAILY GRIND <span/></div><h1>MAKE YOUR<br/><em>HOLDINGS</em><br/>WORK.</h1><p>Mine $ARNOLD every 24 hours. Stay active, stack rewards.</p></section>
        <section className="stats"><article className="stat-card featured"><div className="stat-label"><Coins size={14}/> CLAIMED REWARDS</div><div className="stat-number">{claimed.toLocaleString()} <small>$ARNOLD</small></div><div className="stat-caption">Total rewards claimed</div></article><article className="stat-card"><div className="stat-label"><Gift size={14}/> PENDING</div><div className="stat-number">{pending.toLocaleString()} <small>$ARNOLD</small></div><div className="stat-caption">Ready to claim</div></article></section>
        <section className="mining-card"><div className="card-head"><div><div className="kicker">MINING STATION</div><h2><Pickaxe size={20}/> MINING SESSION</h2></div><div className={miningActive ? 'status active' : miningComplete ? 'status ready' : 'status'}><span/>{miningActive ? 'MINING' : miningComplete ? 'COMPLETED' : 'IDLE'}</div></div>
          <div className="timer-panel"><div className="timer-label">{miningActive ? 'TIME UNTIL CLAIM' : miningComplete ? 'CYCLE COMPLETE' : 'READY FOR YOUR NEXT CYCLE'}</div><div className="timer"><div><strong>{time.hours}</strong><span>HOURS</span></div><i>:</i><div><strong>{time.minutes}</strong><span>MINUTES</span></div><i>:</i><div><strong>{time.secs}</strong><span>SECONDS</span></div></div><div className="progress"><div style={{width: progress + '%'}}/></div><div className="progress-meta"><span>0H</span><span>{Math.floor(progress)}% COMPLETE</span><span>24H</span></div></div>
          <div className="reward-line"><div className="reward-icon"><Zap size={19}/></div><div className="reward-desc"><b>BASE CYCLE REWARD</b><span>Initial reward per completed cycle</span></div><div className="reward-value">+{BASE_REWARD}<small>$ARNOLD</small></div></div>
          {miningComplete ? <button className="primary-btn" onClick={finishCycle}><Check size={18}/> COMPLETE CYCLE</button> : <button className="primary-btn" onClick={startMining} disabled={miningActive || pending > 0}><Pickaxe size={18}/>{miningActive ? 'MINING IN PROGRESS' : pending > 0 ? 'CLAIM PENDING REWARDS FIRST' : 'START MINING'}</button>}
          {pending > 0 && <button className="claim-btn" onClick={claimRewards}><Gift size={17}/> CLAIM {pending} $ARNOLD</button>}
          <p className="helper">{miningActive ? 'Your 24-hour cycle must finish before completing it.' : pending > 0 ? 'Claim your pending rewards before starting another cycle.' : 'One active cycle at a time · 24-hour duration'}</p>
        </section>
        <section className="wallet-panel"><div className="wallet-icon"><Wallet size={20}/></div><div className="wallet-text"><b>WALLET VERIFICATION</b><span>{walletConnected ? 'Preview connected — ownership is not verified.' : 'Connect your wallet to check your $ARNOLD holdings.'}</span></div><button className="wallet-btn" onClick={connectWallet}>{walletConnected ? 'CONNECTED' : 'CONNECT'} <ChevronRight size={15}/></button></section>
        <div className="notice"><ShieldCheck size={15}/><span>Wallet holdings and bonus eligibility will be verified securely before rewards are issued.</span></div>
      </>}
      {tab === 'leaderboard' && <section className="inner-page"><div className="kicker">THE TOP MINERS</div><h1>LEADER<span>BOARD.</span></h1><div className="empty-state"><Trophy size={34}/><b>RANKINGS COMING SOON</b><span>The leaderboard will appear when real mining accounts are enabled.</span></div></section>}
      {tab === 'profile' && <section className="inner-page"><div className="kicker">YOUR ACCOUNT</div><h1>MINER<span>PROFILE.</span></h1><div className="profile-card"><div className="profile-avatar"><Flame size={26}/></div><div><b>TELEGRAM MINER</b><span>{walletConnected ? 'Wallet preview connected' : 'Wallet not connected'}</span></div></div><button className="profile-action" onClick={connectWallet}><Wallet size={17}/>{walletConnected ? 'WALLET PREVIEW CONNECTED' : 'CONNECT WALLET'}<ArrowUpRight size={16}/></button><div className="profile-row"><span>Claimed rewards</span><b>{claimed} $ARNOLD</b></div><div className="profile-row"><span>Pending rewards</span><b>{pending} $ARNOLD</b></div></section>}
    </div>
    <nav className="bottom-nav"><button className={tab === 'mine' ? 'selected' : ''} onClick={() => setTab('mine')}><Pickaxe size={19}/><span>MINE</span></button><button className={tab === 'leaderboard' ? 'selected' : ''} onClick={() => setTab('leaderboard')}><Trophy size={19}/><span>RANKING</span></button><button className={tab === 'profile' ? 'selected' : ''} onClick={() => setTab('profile')}><Activity size={19}/><span>PROFILE</span></button></nav>
    <div className="demo-tag">EARLY PREVIEW · TEST DATA ONLY</div>
  </main>
}