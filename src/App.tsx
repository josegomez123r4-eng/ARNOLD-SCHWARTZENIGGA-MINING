import { useEffect, useState } from 'react'
import { detectLanguage, languages, translate, type LanguageCode } from './i18n'
import WebApp from '@twa-dev/sdk'
import {
  CircleHelp, Clock3, Coins, Flame, Gift, Handshake, ListChecks, LockKeyhole,
  Pickaxe, ShoppingBag, ShieldCheck, Wallet, Zap
} from 'lucide-react'

type Tab = 'mining' | 'tasks' | 'referrals' | 'wallet' | 'market' | 'p2p'

function playShotSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const now = context.currentTime
    const duration = 0.16
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      const envelope = Math.pow(1 - i / data.length, 3)
      data[i] = (Math.random() * 2 - 1) * envelope
    }
    const noise = context.createBufferSource()
    noise.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1800, now)
    filter.frequency.exponentialRampToValueAtTime(220, now + duration)
    const noiseGain = context.createGain()
    noiseGain.gain.setValueAtTime(0.22, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(context.destination)
    noise.start(now)
    noise.stop(now + duration)

    const thump = context.createOscillator()
    const thumpGain = context.createGain()
    thump.type = 'triangle'
    thump.frequency.setValueAtTime(125, now)
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.12)
    thumpGain.gain.setValueAtTime(0.28, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13)
    thump.connect(thumpGain)
    thumpGain.connect(context.destination)
    thump.start(now)
    thump.stop(now + 0.14)
    window.setTimeout(() => { void context.close() }, 350)
  } catch {
    // Audio is optional; the interface remains usable if the browser blocks it.
  }
}

const tabs: { id: Tab; label: string; icon: typeof Pickaxe }[] = [
  { id: 'mining', label: 'Mining', icon: Pickaxe },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'referrals', label: 'Referrals', icon: Gift },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'market', label: 'Market', icon: ShoppingBag },
  { id: 'p2p', label: 'P2P', icon: Handshake },
]

function Header({ language, onLanguageChange }: { language: LanguageCode; onLanguageChange: (language: LanguageCode) => void }) {
  return <header className="topbar">
    <div className="brand"><div className="brand-symbol"><Flame size={21} fill="currentColor" /></div>
      <div><div className="brand-name">ARNOLD</div><div className="brand-sub">SCHWARTZENIGGA MINING</div></div>
    </div>
    <div className="header-actions"><label className="language-picker" aria-label={translate(language, 'Select language')}><span>{languages.find((item) => item.code === language)?.flag}</span><select value={language} onChange={(event) => { playShotSound(); onLanguageChange(event.target.value as LanguageCode) }}>{languages.map((item) => <option key={item.code} value={item.code}>{item.flag} {item.name}</option>)}</select></label><div className="live-pill"><span /> MINI APP</div></div>
  </header>
}

function MiningPage({ t }: { t: (phrase: string) => string }) {
  return <section className="page-section">
    <div className="hero"><div className="overline"><span /> THE DAILY GRIND <span /></div>
      <h1>{t('MAKE YOUR')}<br /><em>{t('HOLDINGS')}</em><br />{t('WORK.')}</h1>
      <p>{t('Mine $ARNOLD every 24 hours. Stay active, stack rewards.')}</p>
    </div>
    <div className="notice notice-large"><ShieldCheck size={17} /><span>{t('Mining is not active yet. Your rewards and wallet eligibility will be verified securely before the first cycle begins.')}</span></div>
    <section className="stats">
      <article className="stat-card featured"><div className="stat-label"><Coins size={14} /> {t('BASE REWARD')}</div><div className="stat-number">5 <small>$ARNOLD</small></div><div className="stat-caption">{t('Per completed 24-hour cycle')}</div></article>
      <article className="stat-card"><div className="stat-label"><Clock3 size={14} /> {t('CYCLE')}</div><div className="stat-number">24 <small>{t('HOURS')}</small></div><div className="stat-caption">{t('One manual cycle at a time')}</div></article>
    </section>
    <section className="mining-card">
      <div className="card-head"><div><div className="kicker">{t('MINING STATION')}</div><h2><Pickaxe size={20} /> {t('MINING SESSION')}</h2></div><div className="status"><span /> {t('NOT ACTIVE')}</div></div>
      <div className="timer-panel"><div className="timer-label">{t('MINING WILL OPEN SOON')}</div>
        <div className="timer"><div><strong>24</strong><span>{t('HOURS')}</span></div><i>:</i><div><strong>00</strong><span>{t('MINUTES')}</span></div><i>:</i><div><strong>00</strong><span>{t('SECONDS')}</span></div></div>
        <div className="progress"><div style={{ width: '0%' }} /></div><div className="progress-meta"><span>0H</span><span>{t('NOT STARTED')}</span><span>24H</span></div>
      </div>
      <div className="reward-line"><div className="reward-icon"><Zap size={19} /></div><div className="reward-desc"><b>{t('BASE CYCLE REWARD')}</b><span>{t('Initial reward before holding bonuses')}</span></div><div className="reward-value">+5<small>$ARNOLD</small></div></div>
      <button className="primary-btn" disabled><LockKeyhole size={17} /> {t('MINING COMING SOON')}</button>
      <p className="helper">{t('Mining remains disabled until all security checks are completed.')}</p>
    </section>
    <div className="section-footnote">{t('Total supply: 1,000,000 $ARNOLD · Mining allocation: 500,000 $ARNOLD')}</div>
  </section>
}

function TasksPage({ t }: { t: (phrase: string) => string }) {
  return <section className="inner-page">
    <div className="kicker">{t('EARN MORE $ARNOLD')}</div><h1>{t('DAILY')}<br /><span>{t('TASKS.')}</span></h1>
    <div className="feature-panel"><div className="feature-icon"><ListChecks size={22} /></div><div><b>{t('REWARD TASKS')}</b><span>{t('Complete activities to earn additional rewards.')}</span></div></div>
    <div className="empty-state"><CircleHelp size={34} /><b>{t('TASKS COMING SOON')}</b><span>{t('Available tasks and their rewards will be published here.')}</span></div>
  </section>
}

function ReferralsPage({ t }: { t: (phrase: string) => string }) {
  return <section className="inner-page">
    <div className="kicker">{t('GROW THE COMMUNITY')}</div><h1>{t('INVITE.')}<br /><span>{t('EARN.')}</span></h1>
    <div className="feature-panel"><div className="feature-icon"><Gift size={22} /></div><div><b>{t('5% LIFETIME REFERRAL REWARD')}</b><span>{t('Earn 5% of eligible mining rewards generated by your direct referrals, subject to the referral reserve.')}</span></div></div>
    <div className="stats referral-stats"><article className="stat-card"><div className="stat-label">{t('YOUR REFERRALS')}</div><div className="stat-number">—</div><div className="stat-caption">{t('Telegram account required')}</div></article><article className="stat-card"><div className="stat-label">{t('PENDING REWARDS')}</div><div className="stat-number">—</div><div className="stat-caption">$ARNOLD</div></article></div>
    <div className="empty-state"><Gift size={34} /><b>{t('REFERRAL DASHBOARD SOON')}</b><span>{t('Your personal invite link and referral history will appear here after Telegram verification is connected.')}</span></div>
  </section>
}

function WalletPage({ t }: { t: (phrase: string) => string }) {
  return <section className="inner-page">
    <div className="kicker">{t('YOUR TON ACCOUNT')}</div><h1>{t('YOUR')}<br /><span>{t('WALLET.')}</span></h1>
    <div className="wallet-connect-card"><div className="wallet-icon"><Wallet size={23} /></div><b>{t('TON WALLET')}</b><span>{t('Connect your TON wallet to verify $ARNOLD holdings and access eligible features.')}</span><button className="primary-btn" disabled><LockKeyhole size={17} /> {t('WALLET CONNECT COMING SOON')}</button></div>
    <div className="profile-row"><span>{t('Minimum balance for withdrawals')}</span><b>500 $ARNOLD</b></div>
    <div className="profile-row"><span>{t('Minimum withdrawal')}</span><b>2,500 $ARNOLD</b></div>
    <div className="profile-row"><span>{t('One-time verification')}</span><b>0.10 GRAM</b></div>
    <p className="helper helper-left">{t('The verification payment and withdrawals are not enabled until on-chain transaction validation is implemented.')}</p>
  </section>
}

function MarketPage({ t }: { t: (phrase: string) => string }) {
  return <section className="inner-page">
    <div className="kicker">{t('OFFICIAL ARNOLD STORE')}</div><h1><span>{t('MARKET.')}</span></h1>
    <div className="feature-panel"><div className="feature-icon"><ShoppingBag size={22} /></div><div><b>{t('BUY $ARNOLD DIRECTLY')}</b><span>{t('Official token listings, purchase amounts and prices will be displayed here.')}</span></div></div>
    <div className="market-preview"><div className="market-coin"><Flame size={30} fill="currentColor" /></div><div className="market-token"><b>$ARNOLD</b><span>{t('Official token · TON')}</span></div><div className="market-state">{t('NOT LISTED')}</div></div>
    <div className="empty-state"><ShoppingBag size={34} /><b>{t('OFFICIAL MARKET COMING SOON')}</b><span>{t('The administrator will publish token quantities and prices here. Purchases will open only after the TON sale contract is deployed and tested.')}</span></div>
  </section>
}

function P2PPage({ t }: { t: (phrase: string) => string }) {
  return <section className="inner-page p2p-page">
    <div className="p2p-emblem"><Handshake size={38} /></div><div className="kicker">{t('PEER-TO-PEER TRADING')}</div>
    <h1>P2P<br /><span>{t('MARKET.')}</span></h1>
    <div className="coming-soon">{t('COMING SOON')}</div>
    <p>{t('Trade $ARNOLD directly with other community members. User listings and peer-to-peer orders will arrive in the next phase.')}</p>
    <div className="p2p-lock"><LockKeyhole size={16} /> {t('P2P TRADING IS NOT ACTIVE')}</div>
  </section>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('mining')
  const [language, setLanguage] = useState<LanguageCode>(detectLanguage)
  const t = (phrase: string) => translate(language, phrase)
  const changeLanguage = (next: LanguageCode) => { localStorage.setItem('arnold-language', next); setLanguage(next); document.documentElement.lang = next; document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr' }
  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    try { WebApp.ready(); WebApp.expand(); WebApp.setHeaderColor('#090909'); WebApp.setBackgroundColor('#090909') } catch { /* Browser preview */ }
  }, [])

  return <main className="app-shell">
    <div className="glow glow-a" /><div className="glow glow-b" />
    <Header language={language} onLanguageChange={changeLanguage} />
    <div className="content">
      {tab === 'mining' && <MiningPage t={t} />}
      {tab === 'tasks' && <TasksPage t={t} />}
      {tab === 'referrals' && <ReferralsPage t={t} />}
      {tab === 'wallet' && <WalletPage t={t} />}
      {tab === 'market' && <MarketPage t={t} />}
      {tab === 'p2p' && <P2PPage t={t} />}
    </div>
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'selected' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { playShotSound(); setTab(id) }}>
        <Icon size={18} strokeWidth={tab === id ? 2.4 : 1.8} /><span>{t(label)}</span>
      </button>)}
    </nav>
    <div className="demo-tag">{t('EARLY BUILD · LIVE FEATURES DISABLED')}</div>
  </main>
}
