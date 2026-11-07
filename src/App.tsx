import { useEffect, useRef, useState } from 'react'
import { detectLanguage, languages, translate, type LanguageCode } from './i18n'
import WebApp from '@twa-dev/sdk'

type TonConnectWallet = {
  account: { address: string; chain?: string }
  device?: { appName?: string; platform?: string }
}
type TonConnectInstance = {
  openModal: () => Promise<void>
  disconnect: () => Promise<void>
  sendTransaction: (transaction: { validUntil: number; messages: Array<{ address: string; amount: string }> }) => Promise<{ boc: string }>
  onStatusChange: (callback: (wallet: TonConnectWallet | null) => void) => void
}
declare global {
  interface Window {
    TON_CONNECT_UI?: { TonConnectUI: new (options: { manifestUrl: string }) => TonConnectInstance }
  }
}
import {
  CircleHelp, Clock3, Coins, Flame, Gift, Handshake, ListChecks, LockKeyhole,
  Pickaxe, ShoppingBag, ShieldCheck, Wallet, Zap, Volume2, VolumeX, ArrowDownToLine
} from 'lucide-react'


const ARNOLD_JETTON_MASTER = 'EQAx1gPnzQHLRWULxJJL0mSb-iB88JEcZCc0f8BA8Kk_pa9w'

function normalizeTonAddress(address: string): string | null {
  const raw = address.trim()
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(raw)) {
    const [wc, hash] = raw.split(':')
    return wc + ':' + hash.toLowerCase()
  }
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    if (binary.length !== 36) return null
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    const workchain = new DataView(bytes.buffer).getInt8(1)
    const hash = Array.from(bytes.slice(2, 34), b => b.toString(16).padStart(2, '0')).join('')
    return workchain + ':' + hash
  } catch { return null }
}

type JettonBalanceResponse = {
  balances?: Array<{ balance: string; jetton: { address: string; decimals?: number | string } }>
}

type Tab = 'mining' | 'tasks' | 'referrals' | 'wallet' | 'market' | 'p2p'

const tabs = [
  { id: 'mining', label: 'MINING', icon: Pickaxe },
  { id: 'tasks', label: 'TASKS', icon: ListChecks },
  { id: 'referrals', label: 'REFERRALS', icon: Gift },
  { id: 'wallet', label: 'WALLET', icon: Wallet },
  { id: 'market', label: 'MARKET', icon: ShoppingBag },
  { id: 'p2p', label: 'P2P', icon: Handshake },
] satisfies { id: Tab; label: string; icon: typeof Pickaxe }[]

function startBackgroundMusic() {
  const AudioClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioClass) return { resume: () => {}, stop: () => {}, isRunning: () => false }
  const audio = new AudioClass()
  const master = audio.createGain()
  master.gain.value = 0.22
  const compressor = audio.createDynamicsCompressor()
  compressor.threshold.value = -20
  compressor.knee.value = 12
  compressor.ratio.value = 6
  compressor.attack.value = 0.004
  compressor.release.value = 0.18
  master.connect(compressor)
  compressor.connect(audio.destination)

  // Original retro arcade soundtrack: bright 8-bit lead, pulsing bass and game-like percussion.
  const bpm = 112
  const beat = 60 / bpm
  const melody = [659.25, 783.99, 987.77, 783.99, 587.33, 659.25, 783.99, 523.25,
    659.25, 783.99, 1046.5, 987.77, 783.99, 659.25, 587.33, 523.25]
  const bassline = [130.81, 130.81, 196, 196, 174.61, 174.61, 146.83, 146.83]
  const tone = (frequency: number, at: number, length: number, level: number, wave: OscillatorType, endFrequency?: number) => {
    const osc = audio.createOscillator()
    const amp = audio.createGain()
    osc.type = wave
    osc.frequency.setValueAtTime(frequency, at)
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, at + length)
    amp.gain.setValueAtTime(0.0001, at)
    amp.gain.linearRampToValueAtTime(level, at + 0.008)
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(amp); amp.connect(master)
    osc.start(at); osc.stop(at + length + 0.02)
  }
  const noiseHit = (at: number, length: number, level: number) => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * length), audio.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2)
    const src = audio.createBufferSource()
    const filter = audio.createBiquadFilter()
    const amp = audio.createGain()
    src.buffer = buffer
    filter.type = 'highpass'
    filter.frequency.value = 1600
    amp.gain.setValueAtTime(level, at)
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
    src.connect(filter); filter.connect(amp); amp.connect(master)
    src.start(at); src.stop(at + length)
  }
  let step = 0
  let nextTime = audio.currentTime + 0.05
  const schedule = () => {
    const limit = audio.currentTime + 1
    while (nextTime < limit) {
      const at = nextTime
      const note = step % melody.length
      // Eighth-note arcade melody and a steady pulsing low bass.
      tone(melody[note], at, beat * 0.42, 0.095, 'square')
      if (step % 2 === 0) tone(bassline[Math.floor(step / 2) % bassline.length], at, beat * 0.78, 0.12, 'triangle')
      if (step % 4 === 0) tone(95, at, 0.11, 0.10, 'sine', 42)
      if (step % 4 === 2) noiseHit(at, 0.075, 0.035)
      if (step % 8 === 6) noiseHit(at, 0.045, 0.025)
      step++
      nextTime += beat / 2
    }
  }
  let timer: number | null = null
  let started = false
  const resume = async () => {
    try {
      await audio.resume()
      if (audio.state !== 'running' || started) return
      started = true
      schedule()
      timer = window.setInterval(schedule, 100)
    } catch {
      // The browser may require another direct user interaction before audio can start.
    }
  }
  const stop = () => {
    if (timer !== null) window.clearInterval(timer)
    timer = null
    started = false
    void audio.close()
  }
  return { resume, stop, isRunning: () => audio.state === 'running' }
}

function Header({ language, onLanguageChange, musicOn, onMusicToggle }: { language: LanguageCode; onLanguageChange: (language: LanguageCode) => void; musicOn: boolean; onMusicToggle: () => void }) {
  return <header className="topbar">
    <div className="brand"><div className="brand-symbol"><Flame size={21} fill="currentColor" /></div>
      <div><div className="brand-name">ARNOLD</div><div className="brand-sub">SCHWARTZENIGGA MINING</div></div>
    </div>
    <div className="header-actions"><button className="music-toggle" type="button" onClick={onMusicToggle} aria-label={musicOn ? "Mute music" : "Play music"}>{musicOn ? <Volume2 size={16} /> : <VolumeX size={16} />}<span>{musicOn ? "MUSIC ON" : "MUSIC OFF"}</span></button><label className="language-picker" aria-label={translate(language, 'Select language')}><span>{languages.find((item) => item.code === language)?.flag}</span><select value={language} onChange={(event) => { onLanguageChange(event.target.value as LanguageCode) }}>{languages.map((item) => <option key={item.code} value={item.code}>{item.flag} {item.name}</option>)}</select></label><div className="live-pill"><span /> MINI APP</div></div>
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
    <div className="eligibility-panel"><div className="eligibility-title"><ShieldCheck size={18} /> <b>{t('REFERRAL ELIGIBILITY')}</b></div><p>{t('A referral only becomes eligible after connecting and verifying a TON wallet.')}</p><p>{t('Each TON wallet can verify only one account. Unverified referrals do not generate rewards.')}</p><small>{t('Wallet proof and duplicate-wallet checks will be enforced by the secure verification system.')}</small></div>
    <div className="empty-state"><Gift size={34} /><b>{t('REFERRAL DASHBOARD SOON')}</b><span>{t('Your personal invite link and referral history will appear here after Telegram verification is connected.')}</span></div>
  </section>
}

function WalletPage({ t, walletAddress, walletReady, onConnect, onDisconnect, onVerifyPayment, walletAppName, paymentState, arnoldBalance, balanceLoading, balanceError }: { t: (phrase: string) => string; walletAddress: string | null; walletReady: boolean; onConnect: () => void; onDisconnect: () => void; onVerifyPayment: () => void; walletAppName: string | null; paymentState: string; arnoldBalance: string | null; balanceLoading: boolean; balanceError: string | null }) {
  return <section className="inner-page">
    <div className="kicker">{t('YOUR TON ACCOUNT')}</div><h1>{t('YOUR')}<br /><span>{t('WALLET.')}</span></h1>
    <div className="wallet-connect-card"><div className="wallet-icon"><Wallet size={23} /></div><b>{t('TON WALLET')}</b><span>{t('Connect your TON wallet to verify $ARNOLD holdings and access eligible features.')}</span><button className="primary-btn wallet-connect-action" type="button" disabled={!walletReady} onClick={walletAddress ? onDisconnect : onConnect}>{walletAddress ? <Wallet size={17} /> : <LockKeyhole size={17} />} {walletAddress ? t("DISCONNECT WALLET") : walletReady ? t("CONNECT TON WALLET") : t("LOADING WALLET CONNECT")}</button>{walletAddress && <div className="connected-address"><span>{t("CONNECTED ADDRESS")}{walletAppName ? ` · ${walletAppName}` : ''}</span><b title={walletAddress}>{walletAddress.slice(0, 10)}…{walletAddress.slice(-8)}</b></div>}</div>
    <div className="arnold-balance-card">
      <div className="balance-caption"><Coins size={15} /> {t('ARNOLD TOKEN BALANCE')}</div>
      <div className="balance-amount">{balanceLoading ? t('LOADING BALANCE') : arnoldBalance !== null ? arnoldBalance : '—'}</div>
      <div className="balance-symbol">$ARNOLD</div>
      {balanceError && <p className="balance-error">{balanceError}</p>}
      {!walletAddress && <p className="balance-hint">{t('Connect your TON wallet to view your $ARNOLD balance.')}</p>}
    </div>
    <div className="verification-payment-card">
      <div className="wallet-withdraw-heading"><Coins size={19} /><div><b>{t('WALLET VERIFICATION')}</b><span>{t('One-time payment')}</span></div></div>
      <div className="profile-row"><span>{t('Verification fee')}</span><b>0.10 TON</b></div>
      <p className="helper helper-left">{t('Pay 0.10 TON from your connected wallet to complete the verification request.')}</p>
      <button className="primary-btn" type="button" disabled={!walletAddress || paymentState === 'sending'} onClick={onVerifyPayment}>
        <LockKeyhole size={17} /> {paymentState === 'sending' ? t('WAITING FOR WALLET') : t('PAY 0.10 TON')}
      </button>
      {paymentState === 'sent' && <p className="balance-hint">{t('Payment submitted. Verification will be completed after on-chain confirmation.')}</p>}
      {paymentState === 'cancelled' && <p className="balance-hint">{t('Payment was cancelled in your wallet.')}</p>}
      {paymentState === 'error' && <p className="balance-error">{t('Payment could not be sent. Please reconnect and try again.')}</p>}
      <p className="payment-destination"><span>{t('PAYMENT DESTINATION')}</span><b>UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk</b></p>
    </div>
    <div className="wallet-withdraw-section">
      <div className="wallet-withdraw-heading"><ArrowDownToLine size={19} /><div><b>{t('WITHDRAW')}</b><span>{t('Withdrawal requirements')}</span></div></div>
      <div className="profile-row"><span>{t('Minimum balance in connected wallet')}</span><b>1,000 $ARNOLD</b></div>
      <div className="profile-row"><span>{t('Minimum withdrawal amount')}</span><b>2,500 $ARNOLD</b></div>
      <div className="profile-row"><span>{t('Withdrawal fee')}</span><b>5%</b></div>
      <p className="helper helper-left">{t('Keep at least 1,000 $ARNOLD in your connected wallet to qualify. This balance is not deducted from your withdrawal.')}</p>
      <button className="primary-btn withdraw-disabled" type="button" disabled><LockKeyhole size={17} /> {t('WITHDRAWALS COMING SOON')}</button>
    </div>
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
  const [musicOn, setMusicOn] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletAppName, setWalletAppName] = useState<string | null>(null)
  const [paymentState, setPaymentState] = useState<'idle' | 'sending' | 'sent' | 'cancelled' | 'error'>('idle')
  const [walletReady, setWalletReady] = useState(false)
  const [arnoldBalance, setArnoldBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const stopMusic = useRef<ReturnType<typeof startBackgroundMusic> | null>(null)
  const tonConnect = useRef<TonConnectInstance | null>(null)
  const t = (phrase: string) => translate(language, phrase)
  useEffect(() => {
    const api = window.TON_CONNECT_UI
    if (!api) return
    const connector = new api.TonConnectUI({ manifestUrl: 'https://arnold-schwartzenigga-mining-n6sn.vercel.app/tonconnect-manifest.json' })
    tonConnect.current = connector
    connector.onStatusChange((wallet) => {\n      setWalletAddress(wallet?.account.address ?? null)\n      setWalletAppName(wallet?.device?.appName ?? null)\n      setPaymentState('idle')\n    })
    setWalletReady(true)
    return () => { tonConnect.current = null }
  }, [])
  useEffect(() => {
    if (!walletAddress) {
      setArnoldBalance(null)
      setBalanceError(null)
      setBalanceLoading(false)
      return
    }
    let cancelled = false
    const loadBalance = async () => {
      setBalanceLoading(true)
      setBalanceError(null)
      try {
        const response = await fetch('https://tonapi.io/v2/accounts/' + encodeURIComponent(walletAddress) + '/jettons')
        if (!response.ok) throw new Error('TON API ' + response.status)
        const data = await response.json() as JettonBalanceResponse
        const expectedMaster = normalizeTonAddress(ARNOLD_JETTON_MASTER)
        if (!expectedMaster) throw new Error('Invalid configured Jetton master address')
        const token = (data.balances ?? []).find(item => normalizeTonAddress(item.jetton.address) === expectedMaster)
        if (!cancelled) {
          if (!token) setArnoldBalance('0')
          else {
            const decimals = Number(token.jetton.decimals ?? 9)
            const amount = Number(token.balance) / Math.pow(10, decimals)
            setArnoldBalance(amount.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) }))
          }
        }
      } catch {
        if (!cancelled) setBalanceError(t('Unable to load token balance. Please try again.'))
      } finally {
        if (!cancelled) setBalanceLoading(false)
      }
    }
    void loadBalance()
    const interval = window.setInterval(loadBalance, 30000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [walletAddress, language])
  useEffect(() => () => { stopMusic.current?.stop(); stopMusic.current = null }, [])
  const toggleMusic = () => {
    if (musicOn) {
      stopMusic.current?.stop()
      stopMusic.current = null
      setMusicOn(false)
      return
    }
    const player = startBackgroundMusic()
    stopMusic.current = player
    void player.resume()
    setMusicOn(true)
  }
  const connectWallet = () => { void tonConnect.current?.openModal() }
  const disconnectWallet = () => { void tonConnect.current?.disconnect() }
  const verifyWalletPayment = async () => {
    if (!walletAddress || !tonConnect.current || paymentState === 'sending') return
    setPaymentState('sending')
    try {
      await tonConnect.current.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: 'UQDuU4KpCx7KsjwXJa4N9XizHF9k1s7pfyfzCvftFwofEgGk', amount: '100000000' }]
      })
      setPaymentState('sent')
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      setPaymentState(message.includes('reject') || message.includes('cancel') ? 'cancelled' : 'error')
    }
  }
  const changeLanguage = (next: LanguageCode) => { localStorage.setItem('arnold-language', next); setLanguage(next); document.documentElement.lang = next; document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr' }
  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    try { WebApp.ready(); WebApp.expand(); WebApp.setHeaderColor('#090909'); WebApp.setBackgroundColor('#090909') } catch { /* Browser preview */ }
  }, [])

  return <main className="app-shell">
    <div className="glow glow-a" /><div className="glow glow-b" />
    <Header language={language} onLanguageChange={changeLanguage} musicOn={musicOn} onMusicToggle={toggleMusic} />
    <div className="content">
      {tab === 'mining' && <MiningPage t={t} />}
      {tab === 'tasks' && <TasksPage t={t} />}
      {tab === 'referrals' && <ReferralsPage t={t} />}
      {tab === 'wallet' && <WalletPage t={t} walletAddress={walletAddress} walletReady={walletReady} onConnect={connectWallet} onDisconnect={disconnectWallet} onVerifyPayment={verifyWalletPayment} walletAppName={walletAppName} paymentState={paymentState} arnoldBalance={arnoldBalance} balanceLoading={balanceLoading} balanceError={balanceError} />}
      {tab === 'market' && <MarketPage t={t} />}
      {tab === 'p2p' && <P2PPage t={t} />}
    </div>
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'selected' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id) }}>
        <Icon size={18} strokeWidth={tab === id ? 2.4 : 1.8} /><span>{t(label)}</span>
      </button>)}
    </nav>
    <div className="demo-tag">{t('EARLY BUILD · LIVE FEATURES DISABLED')}</div>
  </main>
}
