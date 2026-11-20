import { useEffect, useRef, useState } from 'react'
import { detectLanguage, languages, translate, type LanguageCode } from './i18n'
import WebApp from '@twa-dev/sdk'
import { beginCell } from '@ton/core'

type TonConnectWallet = {
  account: { address: string; chain?: string }
  device?: { appName?: string; platform?: string }
}
type TonConnectInstance = {
  openModal: () => Promise<void>
  disconnect: () => Promise<void>
  sendTransaction: (transaction: { validUntil: number; messages: Array<{ address: string; amount: string; payload?: string }> }) => Promise<{ boc: string }>
  onStatusChange: (callback: (wallet: TonConnectWallet | null) => void) => void
  wallet?: TonConnectWallet | null
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

type MiningStatus = { verified: boolean; wallet_address?: string | null; cycle: { id: string; status: string; started_at: string; ends_at: string; total_reward: string } | null; earned: string; pending: string }
function ArnoldWorkoutMascot({ active }: { active: boolean }) {
  return <div className={active ? 'arnold-mascot is-training' : 'arnold-mascot is-resting'} aria-label={active ? 'Arnold entrenando mientras mina' : 'Arnold listo para minar'}>
    <div className="mascot-copy"><b>{active ? 'ARNOLD IS GRINDING' : 'READY TO GRIND'}</b><span>{active ? 'Cada segundo cuenta' : 'Activa tu próximo ciclo'}</span></div>
    <svg className="mascot-art" viewBox="0 0 176 142" role="img" aria-hidden="true">
      <defs><linearGradient id="arnoldSkin" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#ffd98a"/><stop offset="1" stopColor="#bd7130"/></linearGradient><linearGradient id="arnoldTop" x1="0" x2="1"><stop stopColor="#ffcf63"/><stop offset="1" stopColor="#d87920"/></linearGradient></defs>
      <ellipse cx="89" cy="132" rx="66" ry="7" fill="#ff9b2b" opacity=".18"/>
      <path d="M61 61 Q88 48 115 61 L126 119 Q89 132 51 119Z" fill="url(#arnoldTop)" stroke="#ffe0a0" strokeWidth="2"/>
      <path d="M68 69 Q88 79 108 69 L104 118 L72 118Z" fill="#17100a" opacity=".8"/>
      <path d="M68 28 Q89 9 110 28 L108 53 Q99 65 88 65 Q76 63 68 52Z" fill="url(#arnoldSkin)" stroke="#ffe0a0" strokeWidth="1.5"/>
      <path d="M66 31 Q69 8 91 10 Q112 10 114 31 L107 25 L101 20 L93 25 L81 21 L72 31Z" fill="#282019"/>
      <path d="M76 40 Q81 37 85 40 M94 40 Q99 37 103 40" fill="none" stroke="#4a2615" strokeWidth="2" strokeLinecap="round"/>
      <path d="M82 52 Q89 57 97 52" fill="none" stroke="#7b351b" strokeWidth="2" strokeLinecap="round"/>
      <path d="M63 68 Q43 67 34 84 L22 102" fill="none" stroke="url(#arnoldSkin)" strokeWidth="14" strokeLinecap="round"/>
      <path d="M112 68 Q132 67 141 84 L153 102" fill="none" stroke="url(#arnoldSkin)" strokeWidth="14" strokeLinecap="round"/>
      <g className="mascot-arm mascot-arm-left"><path d="M42 83 Q25 69 18 54" fill="none" stroke="url(#arnoldSkin)" strokeWidth="13" strokeLinecap="round"/><path d="M18 54 L18 39" stroke="#f2bd52" strokeWidth="5" strokeLinecap="round"/><path d="M8 37 H28" stroke="#f2bd52" strokeWidth="6" strokeLinecap="round"/><path d="M11 32 V42 M25 32 V42" stroke="#ffe09a" strokeWidth="3"/></g>
      <g className="mascot-arm mascot-arm-right"><path d="M134 83 Q151 69 158 54" fill="none" stroke="url(#arnoldSkin)" strokeWidth="13" strokeLinecap="round"/><path d="M158 54 L158 39" stroke="#f2bd52" strokeWidth="5" strokeLinecap="round"/><path d="M148 37 H168" stroke="#f2bd52" strokeWidth="6" strokeLinecap="round"/><path d="M151 32 V42 M165 32 V42" stroke="#ffe09a" strokeWidth="3"/></g>
      <path d="M74 82 Q88 92 102 82" fill="none" stroke="#ffe4a8" strokeWidth="2" opacity=".8"/>
      <path d="M82 97 L95 97" stroke="#ffe4a8" strokeWidth="2" strokeLinecap="round" opacity=".8"/>
    </svg>
    <span className="mascot-status"><i /> {active ? 'MINING ACTIVE' : 'MINING STANDBY'}</span>
  </div>
}

function MiningPage({ t, onOpenReferrals, onOpenWallet, miningStatus, onStartMining, onClaimMining, miningBusy }: { t: (phrase: string) => string; onOpenReferrals: () => void; onOpenWallet: () => void; miningStatus: MiningStatus | null; onStartMining: () => void; onClaimMining: () => void; miningBusy: boolean }) {
  const cycle = miningStatus?.cycle ?? null
  const [now, setNow] = useState(Date.now())
  const [boostOpen, setBoostOpen] = useState(false)
  useEffect(() => {
    if (!cycle || new Date(cycle.ends_at).getTime() <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [cycle?.id, cycle?.ends_at])
  const startedAt = cycle ? new Date(cycle.started_at).getTime() : 0
  const endsAt = cycle ? new Date(cycle.ends_at).getTime() : 0
  const duration = Math.max(1, endsAt - startedAt)
  const remaining = cycle ? Math.max(0, endsAt - now) : 24 * 60 * 60 * 1000
  const elapsed = cycle ? Math.min(duration, Math.max(0, now - startedAt)) : 0
  const cycleFinished = !!cycle && remaining <= 0
  const totalReward = cycle ? Math.max(0, Number(cycle.total_reward) || 5) : 5
  const hourlyReward = totalReward / 24
  const estimatedMined = cycle ? totalReward * (elapsed / duration) : 0
  const formatClock = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return [hours, minutes, secs].map(value => String(value).padStart(2, '0')).join(':')
  }
  const progressPercent = cycle ? Math.min(100, Math.max(0, elapsed / duration * 100)) : 0
  return <section className="page-section">
    <div className="hero mining-hero"><div className="overline"><span /> THE DAILY GRIND <span /></div>
      <h1>{t('MAKE YOUR')}<br /><em>{t('HOLDINGS')}</em><br />{t('WORK.')}</h1>
      <p>{t('Mine $ARNOLD every 24 hours. Stay active, stack rewards.')}</p>
    </div>
    <section className="earnings-summary" aria-label="Resumen de ganancias">
      <div className="earnings-summary-head">
        <div><div className="kicker">{t('YOUR REWARDS')}</div><h2><Coins size={19} /> {t('EARNINGS SUMMARY')}</h2></div>
        <span className="earnings-live-label">{t('CONFIRMED')}</span>
      </div>
      <div className="earnings-total"><span>{t('TOTAL EARNED')}</span><strong>{miningStatus?.earned ?? '—'} <small>$ARNOLD</small></strong></div>
      <div className="earnings-sources">
        <div className="earnings-source"><span><ListChecks size={15} /> {t('TASK REWARDS')}</span><b>— <small>$ARNOLD</small></b></div>
        <div className="earnings-source"><span><Pickaxe size={15} /> {t('MINING REWARDS')}</span><b>{miningStatus?.earned ?? '—'} <small>$ARNOLD</small></b></div>
      </div>
      <p className="earnings-note">{miningStatus ? 'Recompensas confirmadas en el registro interno de ARNOLD.' : t('Only confirmed rewards will appear here.')}</p>
    </section>
    <section className="mining-card">
      <div className="card-head"><div><div className="kicker">{t('MINING STATION')}</div><h2><Pickaxe size={20} /> {t('MINING SESSION')}</h2></div><div className={cycle ? (cycleFinished ? 'status ready' : 'status active') : 'status'}><span /> {cycle ? (cycleFinished ? 'READY TO CLAIM' : 'ACTIVE') : 'NOT ACTIVE'}</div></div>
      <ArnoldWorkoutMascot active={!!cycle && !cycleFinished} />
      <div className="timer-panel"><div className="timer-label">{cycle ? (cycleFinished ? 'CYCLE COMPLETED' : 'TIME LEFT IN THIS CYCLE') : (miningStatus?.verified ? 'READY TO START' : 'WALLET VERIFICATION REQUIRED')}</div>
        <div className="timer mining-countdown"><strong>{formatClock(remaining)}</strong></div>
        <div className="progress"><div style={{ width: progressPercent + '%' }} /></div><div className="progress-meta"><span>{cycle ? new Date(cycle.started_at).toLocaleTimeString() : '0H'}</span><span>{cycle ? Math.round(progressPercent) + '% COMPLETE' : t('NOT STARTED')}</span><span>{cycle ? new Date(cycle.ends_at).toLocaleTimeString() : '24H'}</span></div>
      </div>
      <div className="mining-live-stats">
        <article><span>MINED IN THIS CYCLE</span><b>{cycle ? estimatedMined.toFixed(6) : '0.000000'} <small>ARNOLD</small></b><em>Estimación en tiempo real</em></article>
        <article><span>PER HOUR</span><b>{hourlyReward.toFixed(6)} <small>ARNOLD</small></b><em>Según recompensa del ciclo</em></article>
        <article><span>24H REWARD</span><b>{totalReward.toFixed(4)} <small>ARNOLD</small></b><em>Al completar el ciclo</em></article>
      </div>
      <div className="reward-line"><div className="reward-icon"><Zap size={19} /></div><div className="reward-desc"><b>{t('BASE CYCLE REWARD')}</b><span>{t('Initial reward before holding bonuses')}</span></div><div className="reward-value">+{totalReward}<small>$ARNOLD</small></div></div>
      <div className="mining-action-buttons">
        <button className="primary-btn mining-start-btn" type="button" disabled={miningBusy || !!cycle || !miningStatus?.verified} onClick={miningStatus?.verified ? onStartMining : onOpenWallet}><Pickaxe size={17} /> {miningBusy ? 'PROCESSING…' : cycle ? 'MINING ACTIVE' : miningStatus?.verified ? 'START MINING' : t('MINING')}</button>
        <button className="claim-btn" type="button" disabled={miningBusy || !cycleFinished} onClick={onClaimMining}><Gift size={17} /> {miningBusy ? 'PROCESSING…' : t('CLAIM')}</button>
      </div>
      <div className="mining-boost-row"><div><b>BOOST YOUR MINING</b><span>Potencia tu producción usando $ARNOLD</span></div><button type="button" onClick={() => setBoostOpen(true)}><Zap size={16} /> BOOST</button></div>
      <p className="helper">{cycle ? (cycleFinished ? 'Tu ciclo terminó. Reclama la recompensa registrada en tu saldo ARNOLD.' : 'Tu ciclo de 24 horas está activo. La cifra minada es una estimación; la recompensa final se confirma al reclamar.') : miningStatus?.verified ? 'Billetera verificada. Puedes iniciar un ciclo de 24 horas.' : 'Conecta y verifica tu billetera con el pago único de 0.10 GRAM para desbloquear la minería.'}</p>
    </section>
    <section className="stats">
      <article className="stat-card featured"><div className="stat-label"><Coins size={14} /> {t('BASE REWARD')}</div><div className="stat-number">5 <small>$ARNOLD</small></div><div className="stat-caption">{t('Per completed 24-hour cycle')}</div></article>
      <article className="stat-card"><div className="stat-label"><Clock3 size={14} /> {t('CYCLE')}</div><div className="stat-number">24 <small>{t('HOURS')}</small></div><div className="stat-caption">{t('One manual cycle at a time')}</div></article>
    </section>
    <div className="community-counter"><span className="community-dot" /><div><b>10,200+</b><span>{t('COMMUNITY USERS · INITIAL BASELINE')}</span></div></div>
    <button className="home-referral-cta" type="button" onClick={onOpenReferrals}>
      <span className="home-referral-icon"><Gift size={19} /></span>
      <span className="home-referral-copy"><b>PROGRAMA DE REFERIDOS</b><small>Invita amigos · Consulta elegibles y pendientes</small></span>
      <span className="home-referral-arrow">VER <span>›</span></span>
    </button>
    <div className="notice notice-large"><ShieldCheck size={17} /><span>La recompensa se confirma en el servidor al completar el ciclo. El contador es solo una estimación visual.</span></div>
    <div className="section-footnote">{t('Total supply: 1,000,000 $ARNOLD · Mining allocation: 500,000 $ARNOLD')}</div>
    {boostOpen && <div className="boost-modal-backdrop" role="presentation" onClick={() => setBoostOpen(false)}>
      <section className="boost-modal" role="dialog" aria-modal="true" aria-labelledby="boost-modal-title" onClick={event => event.stopPropagation()}>
        <button className="boost-modal-close" type="button" onClick={() => setBoostOpen(false)} aria-label="Cerrar">×</button>
        <div className="boost-modal-icon"><Zap size={24} /></div><div className="kicker">ARNOLD BOOST STORE</div><h2 id="boost-modal-title">BOOST YOUR POWER</h2>
        <p>Mejora tu producción pagando con $ARNOLD. Los precios y compras se habilitarán después de definir los límites de emisión y la reserva de recompensas.</p>
        <div className="boost-options">
          <article><b>BRONZE</b><strong>+5%</strong><span>24 HORAS</span><small>Precio por definir</small></article>
          <article><b>SILVER</b><strong>+10%</strong><span>24 HORAS</span><small>Precio por definir</small></article>
          <article><b>GOLD</b><strong>+15%</strong><span>24 HORAS</span><small>Precio por definir</small></article>
        </div>
        <div className="boost-safety-note"><ShieldCheck size={16} /> Compras desactivadas por ahora. Ningún ARNOLD será cobrado hasta aprobar la economía del Boost.</div>
        <button className="primary-btn boost-coming-btn" type="button" disabled>COMING SOON</button>
      </section>
    </div>}
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
  const telegramId = WebApp.initDataUnsafe?.user?.id
  const startParam = WebApp.initDataUnsafe?.start_param
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [stats, setStats] = useState({ total: 0, eligible: 0, ineligible: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inviteUrl = telegramId
    ? 'https://t.me/ArnoldMiningOfficialBot?startapp=' + encodeURIComponent('ref_' + String(telegramId))
    : ''
  const shareUrl = inviteUrl
    ? 'https://t.me/share/url?url=' + encodeURIComponent(inviteUrl) + '&text=' + encodeURIComponent(t('Join ARNOLD and start earning $ARNOLD.'))
    : ''
  useEffect(() => {
    const initData = WebApp.initData
    if (!initData || !telegramId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const endpoint = 'https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/referral-service'
        const queryRef = new URLSearchParams(window.location.search).get('ref')
        const rawReferrer = startParam?.startsWith('ref_') ? startParam.slice(4) : queryRef
        const referrer = rawReferrer && /^\d{1,20}$/.test(rawReferrer) ? rawReferrer : null
        if (referrer && referrer !== String(telegramId)) {
          const syncResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync', initData, referrerTelegramId: referrer })
          })
          if (!syncResponse.ok) {
            const syncData = await syncResponse.json().catch(() => ({}))
            throw new Error(syncData?.error || 'No se pudo registrar la invitación')
          }
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stats', initData })
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || 'No se pudieron cargar los referidos')
        if (!cancelled) setStats({
          total: Number(data.total || 0),
          eligible: Number(data.eligible || 0),
          ineligible: Number(data.ineligible || 0)
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los referidos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [telegramId, startParam])
  const copyInvite = async () => {
    if (!inviteUrl) return
    setCopyError('')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
      } else {
        const input = document.createElement('textarea')
        input.value = inviteUrl
        input.setAttribute('readonly', '')
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        const copiedSuccessfully = document.execCommand('copy')
        document.body.removeChild(input)
        if (!copiedSuccessfully) throw new Error('COPY_NOT_SUPPORTED')
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
      setCopyError('No se pudo copiar automáticamente. Mantén pulsado el enlace para copiarlo.')
    }
  }
  return <section className="inner-page">
    <div className="kicker">{t('GROW THE COMMUNITY')}</div><h1>{t('INVITE.')}<br /><span>{t('EARN.')}</span></h1>
    <div className="feature-panel"><div className="feature-icon"><Gift size={22} /></div><div><b>{t('INVITE FRIENDS')}</b><span>{t('Share your personal invite link and help grow the ARNOLD community.')}</span></div></div>
    <div className="referral-invite-card">
      <div className="referral-invite-heading"><Gift size={18} /><b>{t('YOUR INVITE LINK')}</b></div>
      {inviteUrl ? <>
        <input className="referral-link-input" readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()} aria-label={t('YOUR INVITE LINK')} />
        <button className="primary-btn" type="button" onClick={() => { void copyInvite() }}>{copied ? '✓ ENLACE COPIADO' : 'COPIAR ENLACE'}</button>
        <a className="referral-share-btn" href={shareUrl} target="_blank" rel="noreferrer"><Gift size={16} /> COMPARTIR POR TELEGRAM</a>
        {copyError && <p className="balance-error" role="alert">{copyError}</p>}
        <p className="referral-link-help">Cada amigo que abra este enlace desde Telegram quedará asociado a tu invitación.</p>
      </> : <>
        <p className="referral-link-help">Abre la Mini App desde Telegram para generar tu enlace personal de invitación.</p>
        <a className="referral-share-btn" href="https://t.me/ArnoldMiningOfficialBot" target="_blank" rel="noreferrer">ABRIR @ArnoldMiningOfficialBot</a>
      </>}
    </div>
    <div className="stats referral-stats">
      <article className="stat-card"><div className="stat-label">TOTAL DE INVITADOS</div><div className="stat-number">{loading ? '…' : stats.total}</div><div className="stat-caption">Personas que se registraron con tu enlace</div></article>
      <article className="stat-card"><div className="stat-label">ELEGIBLES</div><div className="stat-number">{loading ? '…' : stats.eligible}</div><div className="stat-caption">Billetera confirmada y tarifa verificada</div></article>
      <article className="stat-card"><div className="stat-label">AÚN NO ELEGIBLES</div><div className="stat-number">{loading ? '…' : stats.ineligible}</div><div className="stat-caption">Pendientes de completar la verificación</div></article>
    </div>
    {error && <p className="balance-error" role="alert">{error}</p>}
    <div className="eligibility-panel"><div className="eligibility-title"><ShieldCheck size={18} /> <b>REQUISITOS DE ELEGIBILIDAD</b></div><p>Un invitado cuenta como elegible únicamente después de confirmar su billetera y completar el pago único de 0.10 GRAM, verificado de forma segura en la blockchain.</p></div>
  </section>
}
function WalletPage({ t, walletAddress, walletReady, onConnect, onDisconnect, onReconnect, onRefreshBalance, onVerifyPayment, walletAppName, paymentState, arnoldBalance, balanceLoading, balanceError }: { t: (phrase: string) => string; walletAddress: string | null; walletReady: boolean; onConnect: () => void; onDisconnect: () => void; onReconnect: () => void; onRefreshBalance: () => void; onVerifyPayment: () => void; walletAppName: string | null; paymentState: string; arnoldBalance: string | null; balanceLoading: boolean; balanceError: string | null }) {
  return <section className="inner-page">
    <div className="kicker">{t('YOUR TON ACCOUNT')}</div><h1>{t('YOUR')}<br /><span>{t('WALLET.')}</span></h1>
    <div className="wallet-connect-card"><div className="wallet-icon"><Wallet size={23} /></div><b>{t('TON WALLET')}</b><span>{t('Connect your TON wallet to verify $ARNOLD holdings and access eligible features.')}</span><button className="primary-btn wallet-connect-action" type="button" disabled={!walletReady} onClick={walletAddress ? onDisconnect : onConnect}>{walletAddress ? <Wallet size={17} /> : <LockKeyhole size={17} />} {walletAddress ? t("DISCONNECT WALLET") : walletReady ? t("CONNECT TON WALLET") : t("LOADING WALLET CONNECT")}</button>{walletAddress && <><div className="connected-address"><span>{t("CONNECTED ADDRESS")}{walletAppName ? ` · ${walletAppName}` : ''}</span><b title={walletAddress}>{walletAddress.slice(0, 10)}…{walletAddress.slice(-8)}</b></div><button className="wallet-switch-btn" type="button" onClick={onReconnect}>{t('CHANGE WALLET')}</button></>}</div>
    <div className="arnold-balance-card">
      <div className="balance-caption"><Coins size={15} /> {t('ARNOLD TOKEN BALANCE')}</div>
      <div className="balance-amount">{balanceLoading ? t('LOADING BALANCE') : arnoldBalance !== null ? arnoldBalance : '—'}</div>
      <div className="balance-symbol">$ARNOLD</div>
      {balanceError && <><p className="balance-error">{balanceError}</p><button className="wallet-switch-btn" type="button" onClick={onRefreshBalance}>{t('RETRY BALANCE')}</button></>}
      {!walletAddress && <p className="balance-hint">{t('Connect your TON wallet to view your $ARNOLD balance.')}</p>}
    </div>
    <div className="verification-payment-card">
      <div className="wallet-withdraw-heading"><Coins size={19} /><div><b>{t('WALLET VERIFICATION')}</b><span>{t('One-time payment')}</span></div></div>
      <div className="profile-row"><span>{t('Verification fee')}</span><b>0.10 GRAM</b></div>
      <p className="helper helper-left">{t('Pay 0.10 GRAM from your connected wallet to complete the verification request.')}</p>
      <button className="primary-btn" type="button" disabled={!walletAddress || paymentState === 'sending' || paymentState === 'verified'} onClick={onVerifyPayment}>
        <LockKeyhole size={17} /> {paymentState === 'sending' ? 'COMPROBANDO PAGO…' : paymentState === 'sent' ? 'COMPROBAR PAGO ANTERIOR' : paymentState === 'verified' ? '✅ VERIFICADO' : t('PAY 0.10 GRAM')}
      </button>
      {paymentState === 'sent' && <p className="balance-hint">Ya existe un pago enviado. Pulsa “COMPROBAR PAGO ANTERIOR”; no se abrirá otra transacción ni se realizará otro cobro.</p>}
      {paymentState === 'verified' && <p className="balance-hint">Billetera verificada en la blockchain. Ya puedes iniciar minería y participar en referidos.</p>}
      {paymentState === 'cancelled' && <p className="balance-hint">{t('Payment was cancelled in your wallet.')}</p>}
      {paymentState === 'error' && <p className="balance-error">{t('Payment could not be sent. Please reconnect and try again.')}</p>}
    </div>
    <section className="staking-coming-card">
      <div className="wallet-withdraw-heading"><Coins size={19} /><div><b>{t('STAKING')}</b><span>{t('Earn rewards by staking $ARNOLD')}</span></div></div>
      <div className="staking-coming-label">{t('COMING SOON')}</div>
      <p className="helper helper-left">{t('Staking pools, lock periods and reward rates will be announced before launch.')}</p>
    </section>
    <section className="positions-panel">
      <div className="wallet-withdraw-heading"><ListChecks size={19} /><div><b>{t('USER POSITIONS')}</b><span>{t('Wallet ranking')}</span></div></div>
      <div className="positions-table-wrap"><table className="positions-table"><thead><tr><th>{t('RANK')}</th><th>{t('WALLET')}</th><th>$ARNOLD</th></tr></thead><tbody><tr><td>—</td><td>{walletAddress ? walletAddress.slice(0,7)+'…'+walletAddress.slice(-5) : t('NOT CONNECTED')}</td><td>{arnoldBalance ?? '—'}</td></tr></tbody></table></div>
      <p className="chart-disclaimer">{t('Global user rankings will be enabled when the shared user database is connected.')}</p>
    </section>
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

function MarketPage({ walletAddress, onConnect, tonConnect }: { walletAddress: string | null; onConnect: () => void; tonConnect: TonConnectInstance | null }) {
  const phases = [
    { number: 1, amount: '50,000', price: 0.003 },
    { number: 2, amount: '50,000', price: 0.0045 },
    { number: 3, amount: '50,000', price: 0.0065 },
    { number: 4, amount: '50,000', price: 0.008 },
  ]
  const [grams, setGrams] = useState(0.1)
  const [quote, setQuote] = useState<{ ton_usd: string; arnold_usd: string; active_phase: number; purchases_enabled: boolean; timestamp: string } | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState<{ order_id: string; gram_nano: string; recipient: string; memo: string; arnold_amount: string; expires_at: string } | null>(null)
  const [paymentSubmitted, setPaymentSubmitted] = useState(false)
  const [purchaseBusy, setPurchaseBusy] = useState(false)
  const [purchaseMessage, setPurchaseMessage] = useState('')
  const [purchaseError, setPurchaseError] = useState('')
  const saleEndpoint = 'https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/arnold-sale'
  const saleRequest = async (body: Record<string, unknown>) => {
    const response = await fetch(saleEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.message || data?.error || 'No se pudo completar la operación')
    return data
  }
  const verifyOrder = async () => {
    if (!activeOrder || !WebApp.initData || purchaseBusy) return
    setPurchaseBusy(true)
    setPurchaseError('')
    try {
      const result = await saleRequest({ action: 'verify_payment', initData: WebApp.initData, orderId: activeOrder.order_id })
      setPurchaseMessage(result.message || (result.payment_status === 'paid' ? 'Pago confirmado. La entrega está siendo verificada.' : 'Pago aún pendiente de confirmación en TON.'))
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : 'No se pudo verificar el pago')
    } finally {
      setPurchaseBusy(false)
    }
  }
  const startPurchase = async () => {
    if (purchaseBusy) return
    if (!walletAddress) { onConnect(); return }
    if (!tonConnect) { setPurchaseError('La conexión con TON Connect todavía no está lista.'); return }
    if (!WebApp.initData) { setPurchaseError('Abre ARNOLD desde el bot oficial de Telegram para validar tu sesión.'); return }
    if (!quote?.purchases_enabled) return
    if (![0.1, 1, 3, 5, 10, 50].includes(grams)) { setPurchaseError('Selecciona uno de los paquetes disponibles: 0.10, 1, 3, 5, 10 o 50 GRAM.'); return }
    setPurchaseBusy(true)
    setPurchaseError('')
    setPurchaseMessage('')
    try {
      let order = activeOrder
      if (!order) {
        const created = await saleRequest({ action: 'create_order', initData: WebApp.initData, grams: grams.toFixed(1), walletAddress })
        order = {
          order_id: String(created.order_id),
          gram_nano: String(created.gram_nano),
          recipient: String(created.recipient),
          memo: String(created.memo),
          arnold_amount: String(created.arnold_amount),
          expires_at: String(created.expires_at)
        }
        setActiveOrder(order)
      }
      const boc = beginCell().storeUint(0, 32).storeStringTail(order.memo).endCell().toBoc()
      let binary = ''
      for (let i = 0; i < boc.length; i++) binary += String.fromCharCode(boc[i])
      const payload = btoa(binary)
      await tonConnect.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: order.recipient, amount: order.gram_nano, payload }]
      })
      setPaymentSubmitted(true)
      setPurchaseMessage('Transferencia enviada. Estamos comprobando su confirmación en la red TON.')
      const result = await saleRequest({ action: 'verify_payment', initData: WebApp.initData, orderId: order.order_id })
      setPurchaseMessage(result.message || (result.payment_status === 'paid' ? 'Pago confirmado. La entrega está siendo verificada.' : 'Transferencia detectada o pendiente de indexación. Pulsa “Verificar pago” en unos instantes.'))
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : 'No se pudo iniciar la compra')
    } finally {
      setPurchaseBusy(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    const loadQuote = async () => {
      try {
        const response = await fetch('https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/arnold-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'quote' })
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || 'No se pudo obtener la cotización')
        if (!cancelled) {
          setQuote({
            ton_usd: String(data.ton_usd),
            arnold_usd: String(data.arnold_usd),
            active_phase: Number(data.active_phase),
            purchases_enabled: data.purchases_enabled === true,
            timestamp: String(data.ton_quote_timestamp || '')
          })
          setQuoteError('')
        }
      } catch {
        if (!cancelled) setQuoteError('Cotización en vivo no disponible. Inténtalo de nuevo más tarde.')
      } finally {
        if (!cancelled) setQuoteLoading(false)
      }
    }
    void loadQuote()
    const interval = window.setInterval(loadQuote, 30000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [])
  const activePhase = quote?.active_phase ?? 1
  const phasePrice = Number(quote?.arnold_usd ?? phases[activePhase - 1]?.price ?? phases[0].price)
  const tonUsd = Number(quote?.ton_usd ?? 0)
  const estimatedTokens = tonUsd > 0 && phasePrice > 0 ? grams * tonUsd / phasePrice : 0
  const quoteTime = quote?.timestamp ? new Date(quote.timestamp).toLocaleTimeString() : ''
  return <section className="inner-page market-sale-page">
    <div className="market-buy-header">
      <div className="market-buy-brand"><div className="market-buy-logo"><Flame size={25} fill="currentColor" /></div><div><b>ARNOLD</b><span>OFFICIAL TOKEN SALE</span></div></div>
      <div className="market-live-price"><span className={quote ? 'market-live-dot' : 'market-live-dot market-live-dot-off'} />{quote ? '$' + phasePrice.toFixed(quote.active_phase === 1 ? 3 : 4) : '—'}<small>USD / ARNOLD</small></div>
    </div>
    <section className="market-buy-card">
      <div className="market-buy-title"><span>COMPRA $ARNOLD</span><small>{quote ? 'FASE ' + activePhase + ' ACTIVA' : 'VENTA EN PREPARACIÓN'}</small></div>
      <label className="market-amount-label" htmlFor="arnold-gram-amount">Cantidad en GRAM · Elige un paquete</label>
      <div className="market-amount-input"><input id="arnold-gram-amount" type="number" min="0.1" max="50" step="0.1" value={grams} onChange={event => setGrams(Math.max(0.1, Math.min(50, Math.round((Number(event.target.value) || 0.1) * 10) / 10)))} /><span>GRAM</span></div>
      <div className="market-quick-amounts">{[0.1,1,3,5,10,50].map(amount => <button type="button" key={amount} className={grams === amount ? 'active' : ''} onClick={() => setGrams(amount)}>{amount}</button>)}</div>
      <div className="market-quote-rows">
        <div><span>Pagas</span><b>{grams} GRAM</b></div>
        <div><span>Precio de GRAM</span><b>{quote ? '$' + tonUsd.toFixed(4) + ' USD' : '—'}</b></div>
        <div><span>Precio de ARNOLD</span><b>{quote ? '$' + phasePrice.toFixed(4) + ' USD' : '—'}</b></div>
        <div className="market-receive-row"><span>Recibirías aproximadamente</span><b>{quote ? Math.floor(estimatedTokens).toLocaleString() + ' $ARNOLD' : '—'}</b></div>
      </div>
      <p className="market-quote-note">{quoteLoading ? 'Consultando cotización…' : quote ? 'Cotización actualizada ' + quoteTime + '. El importe final se confirma al crear la orden.' : quoteError}</p>
      <button className="market-connect-btn" type="button" onClick={onConnect} disabled={!!walletAddress}>
        <Wallet size={18} /> {walletAddress ? 'BILLETERA CONECTADA' : 'CONECTAR BILLETERA'}
      </button>
      <button className="market-buy-disabled" type="button" disabled={!quote?.purchases_enabled || purchaseBusy || (!walletAddress && !tonConnect)} onClick={() => { if (activeOrder && paymentSubmitted) void verifyOrder(); else void startPurchase() }}>
        <LockKeyhole size={17} /> {purchaseBusy ? 'PROCESANDO…' : activeOrder && paymentSubmitted ? 'VERIFICAR PAGO' : activeOrder ? 'CONTINUAR PAGO' : quote?.purchases_enabled ? 'COMPRAR $ARNOLD' : 'COMPRAS TODAVÍA CERRADAS'}
      </button>
      {purchaseMessage && <p className="market-quote-note" role="status">{purchaseMessage}</p>}
      {purchaseError && <p className="market-quote-note" role="alert">{purchaseError}</p>}
      {activeOrder && <p className="market-buy-footnote">Orden {activeOrder.order_id.slice(0, 8)} · {activeOrder.arnold_amount} $ARNOLD · vence {new Date(activeOrder.expires_at).toLocaleTimeString()}.</p>}
      <p className="market-buy-footnote">{walletAddress ? 'Billetera conectada. La compra solo solicitará la cantidad exacta que confirmes en tu wallet.' : 'Conecta tu billetera TON para poder comprar cuando la venta esté abierta.'}</p>
    </section>
    <div className="sale-inventory market-sale-inventory">
      <div><span>ASIGNACIÓN TOTAL DE VENTA</span><b>200,000 <small>$ARNOLD</small></b></div>
      <div><span>FASES</span><b>4</b></div>
    </div>
    <div className="market-phases-heading"><b>FASES DE LA VENTA</b><span>PROGRESIÓN AUTOMÁTICA</span></div>
    <div className="sale-phase-list">
      {phases.map((phase) => <article className={phase.number === activePhase ? 'sale-phase-card sale-phase-first' : 'sale-phase-card'} key={phase.number}>
        <div className="sale-phase-top"><span>FASE {phase.number}</span><small>{phase.number === activePhase ? 'FASE ACTUAL' : phase.number < activePhase ? 'FASE ANTERIOR' : phase.number === 4 ? 'FASE FINAL' : 'SIGUIENTE FASE'}</small></div>
        <div className="sale-phase-price">{'$' + phase.price}<span>USD / ARNOLD</span></div>
        <div className="sale-phase-allocation"><span>ASIGNACIÓN DE FASE</span><b>{phase.amount} $ARNOLD</b></div>
      </article>)}
    </div>
    <div className="listing-estimate">
      <div className="listing-estimate-label">PRECIO ESTIMADO DE LISTADO</div>
      <strong>$0.01 <small>USD</small></strong>
      <b>STON.fi</b>
      <p>Referencia estimada, no representa un precio garantizado ni una promesa de listado.</p>
    </div>
    <div className="sale-automation-note"><ShieldCheck size={17} /><p>La siguiente fase se activará automáticamente cuando se vendan y confirmen los 50,000 tokens de la fase actual.</p></div>
    <div className="sale-security-note"><LockKeyhole size={15} /><span>La interfaz de compra está preparada, pero los pagos siguen deshabilitados hasta completar y validar todas las pruebas de extremo a extremo.</span></div>
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
  const [paymentState, setPaymentState] = useState<'idle' | 'sending' | 'sent' | 'cancelled' | 'error' | 'verified'>('idle')
  const [verificationIntent, setVerificationIntent] = useState<{ intent_id: string; memo: string; recipient: string; amount_nano: string } | null>(null)
  const [verificationSent, setVerificationSent] = useState(false)
  const [miningStatus, setMiningStatus] = useState<MiningStatus | null>(null)
  const [miningBusy, setMiningBusy] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [arnoldBalance, setArnoldBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [balanceRefresh, setBalanceRefresh] = useState(0)
  const stopMusic = useRef<ReturnType<typeof startBackgroundMusic> | null>(null)
  const tonConnect = useRef<TonConnectInstance | null>(null)
  const t = (phrase: string) => translate(language, phrase)
  useEffect(() => {
    let cancelled = false
    let retryTimer: number | undefined
    const initialize = () => {
      const api = window.TON_CONNECT_UI
      if (!api) {
        retryTimer = window.setTimeout(initialize, 200)
        return
      }
      const connector = new api.TonConnectUI({ manifestUrl: 'https://arnold-schwartzenigga-mining.vercel.app/tonconnect-manifest.json' })
      tonConnect.current = connector
      const syncWallet = (wallet: TonConnectWallet | null) => {
        if (cancelled) return
        setWalletAddress(wallet?.account.address ?? null)
        setWalletAppName(wallet?.device?.appName ?? null)
        setPaymentState('idle')
      }
      connector.onStatusChange(syncWallet)
      syncWallet(connector.wallet ?? null)
      setWalletReady(true)
    }
    initialize()
    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      tonConnect.current = null
    }
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
        const ownerAddress = normalizeTonAddress(walletAddress)
        const expectedMaster = normalizeTonAddress(ARNOLD_JETTON_MASTER)
        if (!ownerAddress) throw new Error('TON Connect returned an invalid wallet address')
        if (!expectedMaster) throw new Error('The configured ARNOLD Jetton master address is invalid')

        // Ask TonAPI for this exact owner + ARNOLD master first. This avoids
        // depending on the default page size/order of the owner's Jetton list.
        const balanceUrl = '/api/arnold-balance?owner=' +
          encodeURIComponent(walletAddress) + '&master=' + encodeURIComponent(ARNOLD_JETTON_MASTER)
        const balanceResponse = await fetch(balanceUrl, { headers: { accept: 'application/json' } })
        if (!balanceResponse.ok) {
          let reason = 'HTTP ' + balanceResponse.status
          try {
            const errorData = await balanceResponse.json() as { error?: string }
            if (errorData.error) reason = errorData.error
          } catch { /* keep HTTP status */ }
          throw new Error(reason)
        }
        const result = await balanceResponse.json() as {
          balance?: string
          decimals?: number
          balances?: Array<{ balance: string; jetton: { address: string; decimals?: number | string } }>
        }
        let token: { balance: string; jetton?: { decimals?: number | string } } | null = null
        if (typeof result.balance === 'string') {
          token = { balance: result.balance, jetton: { decimals: result.decimals ?? 9 } }
        } else {
          const match = (result.balances ?? []).find(item =>
            normalizeTonAddress(item.jetton.address) === expectedMaster
          )
          if (match) token = { balance: match.balance, jetton: match.jetton }
        }

        if (!cancelled) {
          if (!token) {
            setArnoldBalance('0')
          } else {
            const decimals = Math.max(0, Math.min(30, Number(token.jetton?.decimals ?? 9)))
            const raw = BigInt(token.balance)
            const divisor = 10n ** BigInt(decimals)
            const whole = raw / divisor
            const fraction = (raw % divisor).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
            const amount = fraction ? whole.toString() + '.' + fraction : whole.toString()
            setArnoldBalance(Number(amount).toLocaleString(undefined, { maximumFractionDigits: 6 }))
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('ARNOLD balance lookup failed:', error)
          setBalanceError(error instanceof Error ? error.message : t('Unable to load token balance. Please try again.'))
        }
      } finally {
        if (!cancelled) setBalanceLoading(false)
      }
    }
    void loadBalance()
    const interval = window.setInterval(loadBalance, 30000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [walletAddress, language, balanceRefresh])
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
  const reconnectWallet = async () => {
    if (!tonConnect.current) return
    await tonConnect.current.disconnect()
    await tonConnect.current.openModal()
  }
  const refreshBalance = () => setBalanceRefresh((value) => value + 1)
  const walletVerificationEndpoint = 'https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/wallet-verification'
  const miningEndpoint = 'https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/arnold-mining'
  const postTelegramAction = async (endpoint: string, body: Record<string, unknown>) => {
    if (!WebApp.initData) throw new Error('Abre ARNOLD desde el bot oficial de Telegram.')
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, initData: WebApp.initData }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok && response.status !== 202) throw new Error(data?.message || data?.error || 'No se pudo completar la operación')
    return { status: response.status, data }
  }
  const loadMiningStatus = async () => {
    try {
      const result = await postTelegramAction(miningEndpoint, { action: 'status' })
      setMiningStatus(result.data as MiningStatus)
    } catch (error) {
      console.warn('Mining status unavailable:', error)
      setMiningStatus(null)
    }
  }
  const runMiningAction = async (action: 'start' | 'claim') => {
    if (miningBusy) return
    setMiningBusy(true)
    try {
      const body: Record<string, unknown> = { action }
      if (action === 'claim' && miningStatus?.cycle?.id) body.cycleId = miningStatus.cycle.id
      await postTelegramAction(miningEndpoint, body)
      await loadMiningStatus()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo completar la operación')
    } finally {
      setMiningBusy(false)
    }
  }
  const verifyWalletPayment = async () => {
    if (!walletAddress || !tonConnect.current || paymentState === 'sending' || paymentState === 'verified') return
    setPaymentState('sending')
    try {
      let intent = verificationIntent
      if (!intent) {
        const created = await postTelegramAction(walletVerificationEndpoint, { action: 'create_intent', walletAddress })
        intent = created.data as typeof verificationIntent
        if (!intent?.intent_id || !intent.memo || !intent.recipient || !intent.amount_nano) throw new Error('No se pudo crear la orden de verificación.')
        setVerificationIntent(intent)
      }
      if (!verificationSent) {
        const payloadCell = beginCell().storeUint(0, 32).storeStringTail(intent.memo).endCell().toBoc()
        let binary = ''
        for (let i = 0; i < payloadCell.length; i++) binary += String.fromCharCode(payloadCell[i])
        await tonConnect.current.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          messages: [{ address: intent.recipient, amount: intent.amount_nano, payload: btoa(binary) }]
        })
        setVerificationSent(true)
      }
      const checked = await postTelegramAction(walletVerificationEndpoint, { action: 'verify_payment', intentId: intent.intent_id })
      if (checked.data.verified === true) {
        setPaymentState('verified')
        setVerificationIntent(null)
        setVerificationSent(false)
        await loadMiningStatus()
      } else {
        setPaymentState('sent')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      setPaymentState(message.includes('reject') || message.includes('cancel') ? 'cancelled' : 'error')
    }
  }
  useEffect(() => {
    if (!WebApp.initData) return
    let cancelled = false
    const checkWalletVerification = async () => {
      try {
        const result = await postTelegramAction(walletVerificationEndpoint, { action: 'status' })
        if (cancelled) return
        if (result.data.verified && normalizeTonAddress(String(result.data.wallet_address)) === normalizeTonAddress(walletAddress ?? '')) {
          setPaymentState('verified')
          setVerificationIntent(null)
          setVerificationSent(false)
          await loadMiningStatus()
        } else if (result.data.pending_intent && normalizeTonAddress(String(result.data.pending_intent.wallet_address)) === normalizeTonAddress(walletAddress ?? '')) {
          setVerificationIntent(result.data.pending_intent)
          setVerificationSent(true)
          setPaymentState('sent')
        }
      } catch { /* Telegram session or network may not be ready yet */ }
    }
    void checkWalletVerification()
    return () => { cancelled = true }
  }, [walletAddress])
  useEffect(() => { if (WebApp.initData) void loadMiningStatus() }, [])
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
      {tab === 'mining' && <MiningPage t={t} onOpenReferrals={() => setTab('referrals')} onOpenWallet={() => setTab('wallet')} miningStatus={miningStatus} onStartMining={() => { void runMiningAction('start') }} onClaimMining={() => { void runMiningAction('claim') }} miningBusy={miningBusy} />}
      {tab === 'tasks' && <TasksPage t={t} />}
      {tab === 'referrals' && <ReferralsPage t={t} />}
      {tab === 'wallet' && <WalletPage t={t} walletAddress={walletAddress} walletReady={walletReady} onConnect={connectWallet} onDisconnect={disconnectWallet} onReconnect={() => { void reconnectWallet() }} onRefreshBalance={refreshBalance} onVerifyPayment={verifyWalletPayment} walletAppName={walletAppName} paymentState={paymentState} arnoldBalance={arnoldBalance} balanceLoading={balanceLoading} balanceError={balanceError} />}
      {tab === 'market' && <MarketPage walletAddress={walletAddress} onConnect={connectWallet} tonConnect={tonConnect.current} />}
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
