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
  Clock3, Coins, Flame, Gift, Handshake, ListChecks, LockKeyhole,
  Pickaxe, ShoppingBag, ShieldCheck, Wallet, Zap, ArrowDownToLine
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

function Header({ language, onLanguageChange }: { language: LanguageCode; onLanguageChange: (language: LanguageCode) => void }) {
  return <header className="topbar">
    <div className="brand"><img className="brand-logo" src="https://azure-high-cougar-588.mypinata.cloud/ipfs/bafybeid7ztv2vpc77hkdcuvsh7y3dbg54tqair2qvebpcxhgvqg7owhdl4" alt={translate(language, "Arnold Schwartzenigga Mining")} />
      <div><div className="brand-name">ARNOLD</div><div className="brand-sub">SCHWARTZENIGGA MINING</div></div>
    </div>
    <div className="header-actions"><label className="language-picker" aria-label={translate(language, 'Select language')}><select value={language} onChange={(event) => { onLanguageChange(event.target.value as LanguageCode) }}>{languages.map((item) => <option key={item.code} value={item.code}>{item.flag} {item.name}</option>)}</select></label></div>
  </header>
}

type MiningStatus = { verified: boolean; wallet_address?: string | null; cycle: { id: string; status: string; started_at: string; ends_at: string; total_reward: string; base_reward?: string; holding_bonus?: string; purchase_bonus?: string } | null; earned: string; pending: string; purchase_bonus?: { purchased_total: string; purchase_bonus_daily: string; base_reward: string; daily_reward: string; bonus_rate: number } }
type LeaderboardEntry = { rank: number; name: string; total: number; mining: number; tasks: number; referrals: number }
function ArnoldWorkoutMascot({ active, t }: { active: boolean; t: (phrase: string) => string }) {
  const animationUrl = 'https://gateway.pinata.cloud/ipfs/bafybeif3wxsbkq75ukpdk2xzomrgp4ph6i2sz3bggsmsyjjrov5y6sqsue'
  return <div className={active ? 'arnold-mascot is-training' : 'arnold-mascot is-resting'} aria-label={t(active ? 'Arnold entrenando mientras mina' : 'Arnold listo para minar')}>
    <div className="mascot-art-window">
      <img className="mascot-art mascot-animation" src={animationUrl} alt={t("Arnold haciendo curls con dos mancuernas")} />
    </div>
    <span className="mascot-status"><i /> {active ? t('MINING ACTIVE') : t('MINING STANDBY')}</span>
  </div>
}
function MiningPage({ t, onOpenReferrals, onOpenWallet, miningStatus, onStartMining, onClaimMining, miningBusy }: { t: (phrase: string) => string; onOpenReferrals: () => void; onOpenWallet: () => void; miningStatus: MiningStatus | null; onStartMining: () => void; onClaimMining: () => void; miningBusy: boolean }) {
  const cycle = miningStatus?.cycle ?? null
  const [referralEarnings, setReferralEarnings] = useState<number | null>(null)
  useEffect(() => {
    if (!WebApp.initData) return
    let cancelled = false
    const loadReferralEarnings = async () => {
      try {
        const response = await fetch('https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/referral-service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'earnings', initData: WebApp.initData })
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || t('No se pudieron cargar las recompensas por referidos'))
        if (!cancelled) setReferralEarnings(Number(data.referrals) || 0)
      } catch {
        if (!cancelled) setReferralEarnings(null)
      }
    }
    void loadReferralEarnings()
    return () => { cancelled = true }
  }, [])
  const [now, setNow] = useState(Date.now())
  const [boostOpen, setBoostOpen] = useState(false)
  const [rankingOpen, setRankingOpen] = useState(false)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState('')
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const loadLeaderboard = async () => {
    if (!WebApp.initData) { setRankingError(t('Abre ARNOLD desde el bot oficial de Telegram.')); return }
    setRankingLoading(true)
    setRankingError('')
    try {
      const response = await fetch('https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/referral-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leaderboard', initData: WebApp.initData })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || t('No se pudo cargar el ranking'))
      setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : [])
      setMyRank(typeof data.my_rank === 'number' ? data.my_rank : null)
    } catch (error) {
      setRankingError(error instanceof Error ? error.message : t('No se pudo cargar el ranking'))
    } finally {
      setRankingLoading(false)
    }
  }
  useEffect(() => {
    if (!cycle || new Date(cycle.ends_at).getTime() <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [cycle?.id, cycle?.ends_at])
  const startedAt = cycle ? new Date(cycle.started_at).getTime() : 0
  const endsAt = cycle ? new Date(cycle.ends_at).getTime() : 0
  const duration = Math.max(1, endsAt - startedAt)
  const remaining = cycle ? Math.max(0, endsAt - now) : 0
  const elapsed = cycle ? Math.min(duration, Math.max(0, now - startedAt)) : 0
  const cycleFinished = !!cycle && remaining <= 0
  const totalReward = cycle ? Math.max(0, Number(cycle.total_reward) || 5) : 5
  const hourlyReward = cycle ? totalReward / 24 : 0
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
    <div className="mining-banner-wrap">
      <img className="mining-banner-image" src="https://azure-high-cougar-588.mypinata.cloud/ipfs/bafybeibcbq7akhhr7nvlceupzbp7fdv6g4tt7fqliux6437242pkblpjva" alt="ARNOLD mining banner" fetchPriority="high" />
    </div>
    <button className="ranking-entry-card" type="button" onClick={() => { setRankingOpen(true); void loadLeaderboard() }} aria-haspopup="dialog">
      <span className="ranking-entry-trophy" aria-hidden="true">🏆</span>
      <span className="ranking-entry-copy"><b>{t('ARNOLD LEADERBOARD')}</b><small>{t('See top earners from mining, tasks and referrals')}</small></span>
      <span className="ranking-entry-action">{t('VIEW')} <span>›</span></span>
    </button>
    <section className="earnings-summary" aria-label={t("EARNINGS SUMMARY")}>
      <div className="earnings-summary-head">
        <div><div className="kicker">{t('YOUR REWARDS')}</div><h2><Coins size={19} /> {t('EARNINGS SUMMARY')}</h2></div>
        <span className="earnings-live-label">{t('CONFIRMED')}</span>
      </div>
      <div className="earnings-total"><span>{t('TOTAL EARNED')}</span><strong>{miningStatus?.earned ?? '—'} <small>$ARNOLD</small></strong></div>
      <div className="earnings-sources">
        <div className="earnings-source"><span><ListChecks size={15} /> {t('TASK REWARDS')}</span><b>— <small>$ARNOLD</small></b></div>
        <div className="earnings-source"><span><Pickaxe size={15} /> {t('MINING REWARDS')}</span><b>{miningStatus?.earned ?? '—'} <small>$ARNOLD</small></b></div>
        <div className="earnings-source"><span><Gift size={15} /> {t('REFERRAL REWARDS')}</span><b>{referralEarnings === null ? '—' : referralEarnings.toFixed(6)} <small>$ARNOLD</small></b></div>
      </div>
      <p className="earnings-note">{t(miningStatus ? 'Recompensas confirmadas en el registro interno de ARNOLD.' : 'Only confirmed rewards will appear here.')}</p>
    </section>
    <section className="mining-card">
      <div className="card-head"><div><div className="kicker">{t('MINING STATION')}</div><h2><Pickaxe size={20} /> {t('MINING SESSION')}</h2></div><div className={cycle ? (cycleFinished ? 'status ready' : 'status active') : 'status'}><span /> {cycle ? (cycleFinished ? t('READY TO CLAIM') : t('ACTIVE')) : t('NOT ACTIVE')}</div></div>
      <div className="mining-showcase">
        <ArnoldWorkoutMascot active={!!cycle && !cycleFinished} t={t} />
        <div className="mining-meters">
          <article className="mining-meter mining-meter-time">
            <span>{cycle ? (cycleFinished ? t('CYCLE COMPLETED') : t('TIME LEFT')) : t('TIME LEFT')}</span>
            <strong>{formatClock(remaining)}</strong>
            <div className="progress"><div style={{ width: progressPercent + '%' }} /></div>
            <small>{cycle ? Math.round(progressPercent) + '% ' + t('COMPLETE') : t('NOT STARTED')}</small>
          </article>
          <article className="mining-meter mining-meter-earned">
            <span>{t('ARNOLD MINED')}</span>
            <strong>{cycle ? estimatedMined.toFixed(6) : '0.000000'}</strong>
            <small>{t('ARNOLD · EN ESTE CICLO')}</small>
          </article>
          <article className="mining-meter mining-meter-rate">
            <span>{t('MINING RATE')}</span>
            <strong>{hourlyReward.toFixed(6)}</strong>
            <small>{t('ARNOLD / HOUR')}</small>
          </article>
        </div>
      </div>
      <div className="reward-line"><div className="reward-icon"><Zap size={19} /></div><div className="reward-desc"><b>{t('BASE CYCLE REWARD')}</b><span>{t('Initial reward before holding bonuses')}</span></div><div className="reward-value">+{totalReward}<small>$ARNOLD</small></div></div>
      <div className="mining-action-buttons">
        <button className="primary-btn mining-start-btn" type="button" disabled={miningBusy || !!cycle || !miningStatus?.verified} onClick={miningStatus?.verified ? onStartMining : onOpenWallet}><Pickaxe size={17} /> {miningBusy ? t('PROCESSING…') : cycle ? t('MINING ACTIVE') : miningStatus?.verified ? t('START MINING') : t('MINING')}</button>
        <button className={'claim-btn' + (cycleFinished && !miningBusy ? ' claim-ready' : '')} type="button" disabled={miningBusy || !cycleFinished} aria-live="polite" aria-label={cycleFinished ? t('CLAIM REWARD NOW') : t('CLAIM')} onClick={onClaimMining}><Gift size={17} /> {miningBusy ? t('PROCESSING…') : cycleFinished ? t('CLAIM REWARD NOW') : t('CLAIM')}</button>
      </div>
      <div className="mining-boost-row"><div><b>{t('BOOST YOUR MINING')}</b><span>{t('Potencia tu producción usando $ARNOLD')}</span></div><button type="button" onClick={() => setBoostOpen(true)}><Zap size={16} /> {t('BOOST')}</button></div>
      <p className="helper">{t(cycle ? (cycleFinished ? 'Tu ciclo terminó. Reclama la recompensa registrada en tu saldo ARNOLD.' : 'Tu ciclo de 24 horas está activo. La cifra minada es una estimación; la recompensa final se confirma al reclamar.') : miningStatus?.verified ? 'Billetera verificada. Puedes iniciar un ciclo de 24 horas.' : 'Conecta y verifica tu billetera con el pago único de 0.10 GRAM para desbloquear la minería.')}</p>
    </section>
    <section className="stats">
      <article className="stat-card featured"><div className="stat-label"><Coins size={14} /> {t('BASE REWARD')}</div><div className="stat-number">5 <small>$ARNOLD</small></div><div className="stat-caption">{t('Per completed 24-hour cycle')}</div></article>
      <article className="stat-card"><div className="stat-label"><Clock3 size={14} /> {t('CYCLE')}</div><div className="stat-number">24 <small>{t('HOURS')}</small></div><div className="stat-caption">{t('One manual cycle at a time')}</div></article>
    </section>
    <button className="home-referral-cta" type="button" onClick={onOpenReferrals}>
      <span className="home-referral-icon"><Gift size={19} /></span>
      <span className="home-referral-copy"><b>{t('PROGRAMA DE REFERIDOS')}</b><small>{t('Invita amigos · Consulta elegibles y pendientes')}</small></span>
      <span className="home-referral-arrow">{t('VER')} <span>›</span></span>
    </button>
    <div className="notice notice-large"><ShieldCheck size={17} /><span>{t('La recompensa se confirma en el servidor al completar el ciclo. El contador es solo una estimación visual.')}</span></div>
    <div className="section-footnote">{t('Total supply: 1,000,000 $ARNOLD · Mining allocation: 500,000 $ARNOLD')}</div>
    {boostOpen && <div className="boost-modal-backdrop" role="presentation" onClick={() => setBoostOpen(false)}>
      <section className="boost-modal" role="dialog" aria-modal="true" aria-labelledby="boost-modal-title" onClick={event => event.stopPropagation()}>
        <button className="boost-modal-close" type="button" onClick={() => setBoostOpen(false)} aria-label={t('Cerrar')}>×</button>
        <div className="boost-modal-icon"><Zap size={24} /></div><div className="kicker">{t('ARNOLD BOOST STORE')}</div><h2 id="boost-modal-title">{t('BOOST YOUR POWER')}</h2>
        <p>{t('Mejora tu producción pagando con $ARNOLD. Los precios y compras se habilitarán después de definir los límites de emisión y la reserva de recompensas.')}</p>
        <div className="boost-options">
          <article><b>BRONZE</b><strong>+5%</strong><span>{t('24 HORAS')}</span><small>{t('Precio por definir')}</small></article>
          <article><b>SILVER</b><strong>+10%</strong><span>{t('24 HORAS')}</span><small>{t('Precio por definir')}</small></article>
          <article><b>GOLD</b><strong>+15%</strong><span>{t('24 HORAS')}</span><small>{t('Precio por definir')}</small></article>
        </div>
        <div className="boost-safety-note"><ShieldCheck size={16} /> {t('Compras desactivadas por ahora. Ningún ARNOLD será cobrado hasta aprobar la economía del Boost.')}</div>
        <button className="primary-btn boost-coming-btn" type="button" disabled>{t('COMING SOON')}</button>
      </section>
    </div>}
    {rankingOpen && <div className="ranking-modal-backdrop" role="presentation" onClick={() => setRankingOpen(false)}>
      <section className="ranking-modal" role="dialog" aria-modal="true" aria-labelledby="ranking-modal-title" onClick={event => event.stopPropagation()}>
        <button className="ranking-modal-close" type="button" onClick={() => setRankingOpen(false)} aria-label={t('Cerrar ranking')}>×</button>
        <div className="ranking-modal-trophy">🏆</div>
        <div className="kicker">{t('ARNOLD COMMUNITY')}</div>
        <h2 id="ranking-modal-title">{t('GLOBAL RANKING')}</h2>
        <p className="ranking-modal-intro">{t('Ranked by confirmed ARNOLD rewards earned from mining, tasks and referrals.')}</p>
        {myRank !== null && <div className="ranking-my-position"><span>{t('YOUR POSITION')}</span><b>#{myRank}</b></div>}
        {rankingLoading ? <div className="ranking-state">{t('LOADING RANKING')}…</div>
          : rankingError ? <div className="ranking-state ranking-error" role="alert">{rankingError}<button type="button" onClick={() => void loadLeaderboard()}>{t('TRY AGAIN')}</button></div>
          : leaderboard.length === 0 ? <div className="ranking-state">{t('No confirmed rewards yet. Be among the first to earn ARNOLD!')}</div>
          : <div className="ranking-list">{leaderboard.map(entry => <article className={'ranking-row' + (entry.rank <= 3 ? ' ranking-podium' : '')} key={entry.rank}>
              <span className="ranking-place">{entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '#' + entry.rank}</span>
              <div className="ranking-person"><b>{entry.name}</b><small>{t('MINING')} {entry.mining.toLocaleString(undefined, {maximumFractionDigits: 3})} · {t('TASKS')} {entry.tasks.toLocaleString(undefined, {maximumFractionDigits: 3})} · {t('REFERRALS')} {entry.referrals.toLocaleString(undefined, {maximumFractionDigits: 3})}</small></div>
              <strong>{entry.total.toLocaleString(undefined, {maximumFractionDigits: 3})}<small>$ARNOLD</small></strong>
            </article>)}</div>}
        <p className="ranking-modal-footnote">{t('Only server-recorded rewards are counted. Wallet token balances are not included.')}</p>
        <button className="ranking-refresh-btn" type="button" disabled={rankingLoading} onClick={() => void loadLeaderboard()}>{t('REFRESH RANKING')}</button>
      </section>
    </div>}
  </section>
}

function TasksPage({ t }: { t: (phrase: string) => string }) {
  const endpoint = 'https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/task-rewards'
  const [status, setStatus] = useState<{channel_member:boolean;channel_next_available_at:string|null;checkin_streak:number;checkin_claimed_today:boolean;checkin_next_available_at:string} | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<'channel'|'checkin'|null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const post = async (action: string) => {
    if (!WebApp.initData) throw new Error(t('Abre ARNOLD desde el bot oficial de Telegram.'))
    const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,initData:WebApp.initData})})
    const data = await response.json().catch(()=>({}))
    if (!response.ok) throw new Error(data.error === 'CHANNEL_MEMBERSHIP_REQUIRED' ? t('Primero únete al canal de noticias.') : t(data.error || 'No se pudo completar la tarea.'))
    return data
  }
  const refresh = async () => {
    try { const data = await post('status'); setStatus(data); setError('') }
    catch (e) { setError(e instanceof Error ? t(e.message) : t('No se pudieron cargar las tareas.')) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { const timer = window.setInterval(()=>setNow(Date.now()),1000); return ()=>window.clearInterval(timer) }, [])
  const clock = (until: string|null|undefined) => {
    if (!until) return '00:00:00'
    const seconds = Math.max(0,Math.floor((new Date(until).getTime()-now)/1000))
    return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(v=>String(v).padStart(2,'0')).join(':')
  }
  const channelReady = !status?.channel_next_available_at || new Date(status.channel_next_available_at).getTime() <= now
  const checkinReady = !!status && !status.checkin_claimed_today
  const nextCheckin = status?.checkin_next_available_at
  const act = async (kind:'channel'|'checkin') => {
    setBusy(kind);setMessage('');setError('')
    try {
      const data = await post(kind==='channel'?'claim_channel':'claim_checkin')
      setMessage(kind==='channel' ? (data.claimed ? t('¡Recompensa de 2 ARNOLD acreditada!') : t('La tarea todavía está en enfriamiento.')) : (data.claimed ? t('¡Check-in acreditado: +0.5 ARNOLD!') : t('Ya reclamaste el check-in de hoy.')))
      await refresh()
    } catch(e) { setError(e instanceof Error ? t(e.message) : t('No se pudo reclamar.')) }
    finally { setBusy(null) }
  }
  const days = Array.from({length:7},(_,i)=>i+1)
  return <section className="inner-page tasks-page">
    <div className="tasks-banner-wrap"><img className="tasks-banner-image" src="https://azure-high-cougar-588.mypinata.cloud/ipfs/bafybeih5epoypzce6oidj3w5ucf55b6b2otort2qaglzybs5f4kicpfpg4" alt="ARNOLD Daily Tasks" /></div>
    <article className="checkin-card">
      <div className="checkin-heading"><div><div className="kicker">{t('RECOMPENSA DIARIA')}</div><h2>{t('CHECK-IN DE 7 DÍAS')}</h2></div><strong>+0.5 <small>{t('ARNOLD / DÍA')}</small></strong></div>
      <p>{t('Haz check-in cada día para mantener tu racha. Si pierdes un día, vuelves al día 1.')}</p>
      <div className="checkin-days">{days.map(day=><div className={'checkin-day'+(day<=(status?.checkin_streak??0)?' completed':'')+(day===(status?.checkin_streak??0)+1 && !status?.checkin_claimed_today?' current':'')} key={day}><span>{day<=(status?.checkin_streak??0)?'✓':day}</span><small>{t('DÍA')}</small><b>0.5</b></div>)}</div>
      <div className="checkin-total"><span>{t('PROGRESO SEMANAL')}</span><strong>{status?.checkin_streak??0}/7 · {((status?.checkin_streak??0)*0.5).toFixed(1)} / 3.5 ARNOLD</strong></div>
      <button className="checkin-claim-btn" type="button" disabled={busy!==null || !checkinReady} onClick={()=>void act('checkin')}>{busy==='checkin'?t('GUARDANDO…'):checkinReady?t('HACER CHECK-IN · +0.5 ARNOLD'):t('CHECK-IN COMPLETADO HOY')}</button>
      <div className="checkin-countdown">{t('Siguiente check-in en')} <strong>{clock(nextCheckin)}</strong> · {t('Reinicio diario UTC')}</div>
    </article>
    <div className="feature-panel"><div className="feature-icon"><ListChecks size={22} /></div><div><b>{t('REWARD TASKS')}</b><span>{t('Completa tareas y gana recompensas ARNOLD.')}</span></div></div>
    <article className="task-reward-card">
      <div className="task-card-top"><span className="task-card-icon"><Gift size={20}/></span><span className="task-reward-amount">+2 ARNOLD</span></div>
      <h2>{t('Únete a nuestro canal de noticias')}</h2>
      <p>{t('Forma parte de la comunidad y mantente al día con las novedades de ARNOLD.')}</p>
      <a className="task-join-link" href="https://t.me/arnoldschwartzenigganews" target="_blank" rel="noreferrer">{t('IR A LA TAREA')} <span>↗</span></a>
      <div className="task-claim-row">
        <span>{status?.channel_member ? t('Membresía verificada') : t('Únete al canal para desbloquear el reclamo')}</span>
        <button type="button" disabled={busy!==null || !status?.channel_member || !channelReady} onClick={()=>void act('channel')}>{busy==='channel'?t('VERIFICANDO…'):channelReady?t('RECLAMAR 2 ARNOLD'):t('DISPONIBLE EN')+' '+clock(status?.channel_next_available_at)}</button>
      </div>
      {status?.channel_next_available_at && !channelReady && <div className="task-cooldown">{t('Próximo reclamo en')} <strong>{clock(status.channel_next_available_at)}</strong></div>}
    </article>

    {message && <p className="task-feedback success" role="status">{message}</p>}
    {error && <p className="task-feedback error" role="alert">{error}</p>}
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
  const [earnings, setEarnings] = useState({ available: 0, reserved: 0, credited: 0, paid: 0, lifetime: 0, mining: 0, tasks: 0 })
  const [claiming, setClaiming] = useState(false)
  const [claimMessage, setClaimMessage] = useState('')
  const [claimError, setClaimError] = useState('')
  const inviteUrl = telegramId
    ? 'https://t.me/ArnoldMiningOfficialBot?startapp=' + encodeURIComponent('ref_' + String(telegramId))
    : ''
  const shareUrl = inviteUrl
    ? 'https://t.me/share/url?url=' + encodeURIComponent(inviteUrl) + '&text=' + encodeURIComponent('Join ARNOLD and start earning $ARNOLD.')
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
            throw new Error(syncData?.error || t('No se pudo registrar la invitación'))
          }
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stats', initData })
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || t('No se pudieron cargar los referidos'))
        if (!cancelled) setStats({
          total: Number(data.total || 0),
          eligible: Number(data.eligible || 0),
          ineligible: Number(data.ineligible || 0)
        })
        const earningsResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'earnings', initData })
        })
        const earningsData = await earningsResponse.json()
        if (!earningsResponse.ok) throw new Error(earningsData?.error || t('No se pudieron cargar las ganancias'))
        if (!cancelled) setEarnings({
          available: Number(earningsData.available || 0),
          reserved: Number(earningsData.reserved || 0),
          credited: Number(earningsData.credited || 0),
          paid: Number(earningsData.paid || 0),
          lifetime: Number(earningsData.lifetime || 0),
          mining: Number(earningsData.mining || 0),
          tasks: Number(earningsData.tasks || 0)
        })

      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('No se pudieron cargar los referidos'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [telegramId, startParam])
  const requestClaim = async () => {
    if (!WebApp.initData || claiming || earnings.available <= 0) return
    setClaiming(true)
    setClaimMessage('')
    setClaimError('')
    try {
      const response = await fetch('https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/referral-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim', initData: WebApp.initData })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || t('No se pudo acreditar la comisión.'))
      setClaimMessage(t('Comisión acreditada al tablero interno: ') + Number(data.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' $ARNOLD. ' + t('No se realizó ninguna transferencia.'))
      const refresh = await fetch('https://vnslzfivilgdqqgdyoxd.supabase.co/functions/v1/referral-service', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'earnings', initData: WebApp.initData })
      })
      const updated = await refresh.json()
      if (refresh.ok) setEarnings({
        available: Number(updated.available || 0), reserved: Number(updated.reserved || 0),
        credited: Number(updated.credited || 0), paid: Number(updated.paid || 0), lifetime: Number(updated.lifetime || 0),
        mining: Number(updated.mining || 0), tasks: Number(updated.tasks || 0)
      })
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : t('No se pudo registrar la solicitud.'))
    } finally { setClaiming(false) }
  }
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
      setCopyError(t('No se pudo copiar automáticamente. Mantén pulsado el enlace para copiarlo.'))
    }
  }
  return <section className="inner-page">
    <img className="referral-banner" src="https://azure-high-cougar-588.mypinata.cloud/ipfs/bafybeicttszx7a5x7uth3nnjnapi2sou6zmhxmhlzbnrsb7xgzjd47p2xa" alt="Arnold referrals banner" style={{ display: 'block', width: '100%', height: 'auto', objectFit: 'contain', borderRadius: '16px', marginBottom: '18px' }} />
    <div className="feature-panel"><div className="feature-icon"><Gift size={22} /></div><div><b>{t('INVITE FRIENDS')}</b><span>{t('Gana el 5% de las recompensas de minería y tareas de cada referido elegible. Las compras de tus amigos no generan comisión.')}</span></div></div>
    <div className="referral-invite-card">
      <div className="referral-invite-heading"><Gift size={18} /><b>{t('YOUR INVITE LINK')}</b></div>
      {inviteUrl ? <>
        <input className="referral-link-input" readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()} aria-label={t('YOUR INVITE LINK')} />
        <button className="primary-btn" type="button" onClick={() => { void copyInvite() }}>{copied ? '✓ ' + t('ENLACE COPIADO') : t('COPIAR ENLACE')}</button>
        <a className="referral-share-btn" href={shareUrl} target="_blank" rel="noreferrer"><Gift size={16} /> {t('COMPARTIR POR TELEGRAM')}</a>
        {copyError && <p className="balance-error" role="alert">{copyError}</p>}
        <p className="referral-link-help">{t('Cada amigo que abra este enlace desde Telegram quedará asociado a tu invitación.')}</p>
      </> : <>
        <p className="referral-link-help">{t('Abre la Mini App desde Telegram para generar tu enlace personal de invitación.')}</p>
        <a className="referral-share-btn" href="https://t.me/ArnoldMiningOfficialBot" target="_blank" rel="noreferrer">{t('ABRIR @ArnoldMiningOfficialBot')}</a>
      </>}
    </div>
    <div className="referral-earnings-card">
      <div className="referral-earnings-top">
        <div><div className="referral-earnings-label">{t('GANANCIAS DE REFERIDOS')}</div><div className="referral-earnings-total">{earnings.available.toLocaleString(undefined, { maximumFractionDigits: 6 })} <small>$ARNOLD</small></div></div>
        <span className="referral-lifetime-tag">{t('DE POR VIDA')}</span>
      </div>
      <div className="referral-earnings-breakdown">
        <div><span>{t('POR MINERÍA')}</span><b>{earnings.mining.toLocaleString(undefined, { maximumFractionDigits: 6 })}</b></div>
        <div><span>{t('POR TAREAS')}</span><b>{earnings.tasks.toLocaleString(undefined, { maximumFractionDigits: 6 })}</b></div>
      </div>
      <button className="primary-btn referral-claim-btn" type="button" disabled={claiming || earnings.available <= 0} onClick={() => { void requestClaim() }}>
        {claiming ? t('ACREDITANDO…') : t('CLAIM')}
      </button>
      <div className="referral-claim-status">
        <span>{t('EN PROCESO')}: {earnings.reserved.toLocaleString(undefined, { maximumFractionDigits: 6 })} $ARNOLD</span>
        <span>{t('ACREDITADO AL TABLERO')}: {earnings.credited.toLocaleString(undefined, { maximumFractionDigits: 6 })} $ARNOLD</span>
        <span>{t('PAGADO')}: {earnings.paid.toLocaleString(undefined, { maximumFractionDigits: 6 })} $ARNOLD</span>
        <span>{t('TOTAL DE POR VIDA')}: {earnings.lifetime.toLocaleString(undefined, { maximumFractionDigits: 6 })} $ARNOLD</span>
      </div>
      {claimMessage && <p className="referral-claim-message" role="status">{claimMessage}</p>}
      {claimError && <p className="balance-error" role="alert">{claimError}</p>}
      <p className="referral-link-help">{t('Acumulas el 5% de cada recompensa de minería y tareas de tus referidos elegibles, sin límite de tiempo. Las compras no cuentan.')}</p>
    </div>
    <div className="stats referral-stats">
      <article className="stat-card"><div className="stat-label">{t('TOTAL DE INVITADOS')}</div><div className="stat-number">{loading ? '…' : stats.total}</div><div className="stat-caption">{t('Personas que se registraron con tu enlace')}</div></article>
      <article className="stat-card"><div className="stat-label">{t('ELEGIBLES')}</div><div className="stat-number">{loading ? '…' : stats.eligible}</div><div className="stat-caption">{t('Billetera confirmada y tarifa verificada')}</div></article>
      <article className="stat-card"><div className="stat-label">{t('AÚN NO ELEGIBLES')}</div><div className="stat-number">{loading ? '…' : stats.ineligible}</div><div className="stat-caption">{t('Pendientes de completar la verificación')}</div></article>
    </div>
    {error && <p className="balance-error" role="alert">{error}</p>}
    <div className="eligibility-panel"><div className="eligibility-title"><ShieldCheck size={18} /> <b>{t('REQUISITOS DE ELEGIBILIDAD')}</b></div><p>{t('Un invitado cuenta como elegible únicamente después de confirmar su billetera y completar el pago único de 0.10 GRAM, verificado de forma segura en la blockchain.')}</p></div>
  </section>
}
function WalletPage({ t, walletAddress, walletReady, onConnect, onDisconnect, onReconnect, onRefreshBalance, onVerifyPayment, walletAppName, paymentState, arnoldBalance, balanceLoading, balanceError }: { t: (phrase: string) => string; walletAddress: string | null; walletReady: boolean; onConnect: () => void; onDisconnect: () => void; onReconnect: () => void; onRefreshBalance: () => void; onVerifyPayment: () => void; walletAppName: string | null; paymentState: string; arnoldBalance: string | null; balanceLoading: boolean; balanceError: string | null }) {
  return <section className="inner-page">
    <img className="wallet-banner" src="https://azure-high-cougar-588.mypinata.cloud/ipfs/bafybeie5ae7ma5er6ax546jn2ok3gsggpwmlm63zyxl4ry4xrauzdle7jm" alt="ARNOLD Wallet banner" style={{ display: 'block', width: '100%', height: 'auto', objectFit: 'contain', borderRadius: '16px', marginBottom: '18px' }} />
    <div className="wallet-connect-card"><div className="wallet-icon"><Wallet size={23} /></div><b>{t('TON WALLET')}</b><span>{t('Connect your TON wallet to verify $ARNOLD holdings and access eligible features.')}</span><button className="primary-btn wallet-connect-action" type="button" disabled={!walletReady} onClick={walletAddress ? onDisconnect : onConnect}>{walletAddress ? <Wallet size={17} /> : <LockKeyhole size={17} />} {walletAddress ? t("DISCONNECT WALLET") : walletReady ? t("CONNECT TON WALLET") : t("LOADING WALLET CONNECT")}</button>{walletAddress && <><div className="connected-address"><span>{t("CONNECTED ADDRESS")}{walletAppName ? ` · ${walletAppName}` : ''}</span><b title={walletAddress}>{walletAddress.slice(0, 10)}…{walletAddress.slice(-8)}</b></div><button className="wallet-switch-btn" type="button" onClick={onReconnect}>{t('CHANGE WALLET')}</button></>}</div>
    <div className="arnold-balance-card">
      <div className="balance-caption"><Coins size={15} /> {t('ARNOLD TOKEN BALANCE')}</div>
      <div className="balance-amount">{balanceLoading ? t('LOADING BALANCE') : arnoldBalance !== null ? arnoldBalance : '—'}</div>
      <div className="balance-symbol">$ARNOLD</div>
      {walletAddress && <button className="wallet-switch-btn" type="button" onClick={onRefreshBalance} disabled={balanceLoading}>{balanceLoading ? t('LOADING BALANCE') : t('UPDATE BALANCE')}</button>}
      {balanceError && <p className="balance-error" role="alert">{balanceError}</p>}
      {!walletAddress && <p className="balance-hint">{t('Connect your TON wallet to view your $ARNOLD balance.')}</p>}
    </div>
    <div className="verification-payment-card">
      <div className="wallet-withdraw-heading"><Coins size={19} /><div><b>{t('WALLET VERIFICATION')}</b><span>{t('One-time payment')}</span></div></div>
      <div className="profile-row"><span>{t('Verification fee')}</span><b>0.10 GRAM</b></div>
      <p className="helper helper-left">{t('Pay 0.10 GRAM from your connected wallet to complete the verification request.')}</p>
      <button className="primary-btn" type="button" disabled={!walletAddress || paymentState === 'sending' || paymentState === 'verified'} onClick={onVerifyPayment}>
        <LockKeyhole size={17} /> {paymentState === 'sending' ? t('COMPROBANDO PAGO…') : paymentState === 'sent' ? t('COMPROBAR PAGO ANTERIOR') : paymentState === 'verified' ? '✅ ' + t('VERIFICADO') : t('PAY 0.10 GRAM')}
      </button>
      {paymentState === 'sent' && <p className="balance-hint">{t('Ya existe un pago enviado. Pulsa “COMPROBAR PAGO ANTERIOR”; no se abrirá otra transacción ni se realizará otro cobro.')}</p>}
      {paymentState === 'verified' && <p className="balance-hint">{t('Billetera verificada en la blockchain. Ya puedes iniciar minería y participar en referidos.')}</p>}
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

function MarketPage({ t, walletAddress, onConnect, tonConnect }: { t: (phrase: string) => string; walletAddress: string | null; onConnect: () => void; tonConnect: TonConnectInstance | null }) {
  const phases = [
    { number: 1, amount: '50,000', price: 0.003 },
    { number: 2, amount: '50,000', price: 0.0045 },
    { number: 3, amount: '50,000', price: 0.0065 },
    { number: 4, amount: '50,000', price: 0.008 },
  ]
  const [grams, setGrams] = useState('1')
  const [showSalePhases, setShowSalePhases] = useState(false)
  const [quote, setQuote] = useState<{ ton_usd: string; arnold_usd: string; active_phase: number; purchases_enabled: boolean; timestamp: string; source: string } | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState<{ order_id: string; gram_nano: string; recipient: string; memo: string; arnold_amount: string; expires_at: string } | null>(null)
  const [recoveringOrder, setRecoveringOrder] = useState(true)
  const [paymentSubmitted, setPaymentSubmitted] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'fulfilled'>('pending')
  const [payoutStatus, setPayoutStatus] = useState('not_started')
  const [paymentSubmittedAt, setPaymentSubmittedAt] = useState<number | null>(null)
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
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
  const applyOrderVerification = (result: any) => {
    const paid = result.payment_status === 'paid'
    const fulfilled = result.payout_status === 'fulfilled'
    setPaymentStatus(fulfilled ? 'fulfilled' : paid ? 'paid' : 'pending')
    setPayoutStatus(String(result.payout_status ?? (paid ? 'pending' : 'not_started')))
    if (fulfilled) {
      setActiveOrder(null)
      setPaymentSubmitted(false)
      setPaymentSubmittedAt(null)
      setRecoveryAvailable(false)
      setPurchaseMessage('¡Compra completada! Los $ARNOLD llegaron y la entrega fue verificada. Ya puedes realizar otra compra.')
      setPurchaseError('')
      return
    }
    if (paid) {
      const submittedAt = paymentSubmittedAt ?? Date.now()
      setRecoveryAvailable(Date.now() - submittedAt >= 90_000 || result.payout_status === 'failed')
      setPurchaseMessage(result.message || 'Pago confirmado. Estamos verificando automáticamente la llegada de tus $ARNOLD.')
    } else {
      setPurchaseMessage(result.message || 'Pago aún pendiente de confirmación en TON.')
    }
  }
  const verifyOrder = async () => {
    if (!activeOrder || !WebApp.initData || purchaseBusy) return
    setPurchaseBusy(true)
    setPurchaseError('')
    try {
      const result = await saleRequest({ action: 'verify_payment', initData: WebApp.initData, orderId: activeOrder.order_id })
      applyOrderVerification(result)
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : 'No se pudo verificar el pago')
    } finally {
      setPurchaseBusy(false)
    }
  }
  const startPurchase = async () => {
    if (purchaseBusy) return
    if (!walletAddress) { onConnect(); return }
    if (!tonConnect) { setPurchaseError(t('La conexión con TON Connect todavía no está lista.')); return }
    if (!WebApp.initData) { setPurchaseError(t('Abre ARNOLD desde el bot oficial de Telegram para validar tu sesión.')); return }
    if (!quote?.purchases_enabled) return
    const gramsValue = Number(grams.trim())
    if (!/^\d+(\.\d{1,9})?$/.test(grams.trim()) || !Number.isFinite(gramsValue) || gramsValue < 1) { setPurchaseError(t('El mínimo de compra es 1 GRAM. Puedes introducir cualquier cantidad superior.')); return }
    setPurchaseBusy(true)
    setPurchaseError('')
    setPurchaseMessage('')
    try {
      let order = activeOrder
      if (order && new Date(order.expires_at).getTime() <= Date.now()) {
        setActiveOrder(null)
        setPaymentSubmitted(false)
        setPaymentSubmittedAt(null)
        setRecoveryAvailable(false)
        throw new Error(t('La orden anterior venció sin confirmación de pago. Inicia una compra nueva.'))
      }
      if (!order) {
        const created = await saleRequest({ action: 'create_order', initData: WebApp.initData, grams: gramsValue.toFixed(9).replace(/\.?0+$/, ''), walletAddress })
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
      setPaymentStatus('pending')
      setPayoutStatus('pending')
      setPaymentSubmittedAt(Date.now())
      setRecoveryAvailable(false)
      setPurchaseMessage(t('Transferencia enviada. Verificando automáticamente el pago y la entrega de ARNOLD…'))
      const result = await saleRequest({ action: 'verify_payment', initData: WebApp.initData, orderId: order.order_id })
      applyOrderVerification(result)
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : t('No se pudo iniciar la compra'))
    } finally {
      setPurchaseBusy(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    const recoverLatestOrder = async () => {
      if (!WebApp.initData) { if (!cancelled) setRecoveringOrder(false); return }
      try {
        const result = await saleRequest({ action: 'recover_order', initData: WebApp.initData })
        const recovered = result?.order
        if (!cancelled && recovered?.order_id) {
          setActiveOrder({
            order_id: String(recovered.order_id),
            gram_nano: String(recovered.gram_nano),
            recipient: String(recovered.recipient),
            memo: String(recovered.memo),
            arnold_amount: String(recovered.arnold_amount),
            expires_at: String(recovered.expires_at)
          })
          setPaymentSubmitted(true)
          setPaymentStatus('paid')
          setPayoutStatus(String(recovered.payout_status ?? 'pending'))
          setPaymentSubmittedAt(Date.now())
          setRecoveryAvailable(false)
          setPurchaseMessage(t('Encontramos una compra pagada. Estamos comprobando automáticamente si los tokens ya llegaron.'))
        }
      } catch (error) {
        if (error instanceof Error && !error.message.includes('NO_RECOVERABLE_ORDER') && !cancelled) {
          setPurchaseError(t('No pudimos recuperar automáticamente tu orden. Inténtalo de nuevo en unos momentos.'))
        }
      } finally {
        if (!cancelled) setRecoveringOrder(false)
      }
    }
    void recoverLatestOrder()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!activeOrder || !paymentSubmitted || !WebApp.initData || paymentStatus === 'fulfilled') return
    let cancelled = false
    const checkDelivery = async () => {
      try {
        const result = await saleRequest({ action: 'verify_payment', initData: WebApp.initData, orderId: activeOrder.order_id })
        if (!cancelled) applyOrderVerification(result)
      } catch {
        if (!cancelled && paymentStatus === 'paid' && paymentSubmittedAt && Date.now() - paymentSubmittedAt >= 90_000) {
          setRecoveryAvailable(true)
        }
      }
    }
    void checkDelivery()
    const timer = window.setInterval(() => { void checkDelivery() }, 6000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeOrder?.order_id, paymentSubmitted, paymentStatus, paymentSubmittedAt])

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
        if (!response.ok) throw new Error(data?.error || t('No se pudo obtener la cotización'))
        if (!cancelled) {
          setQuote({
            ton_usd: String(data.ton_usd),
            arnold_usd: String(data.arnold_usd),
            active_phase: Number(data.active_phase),
            purchases_enabled: data.purchases_enabled === true,
            timestamp: String(data.ton_quote_timestamp || ''),
            source: String(data.quote_source || 'market data')
          })
          setQuoteError('')
        }
      } catch {
        if (!cancelled) setQuoteError(t('Cotización en vivo no disponible. Inténtalo de nuevo más tarde.'))
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
  const gramsValue = Number(grams)
  const estimatedTokens = tonUsd > 0 && phasePrice > 0 && Number.isFinite(gramsValue) ? gramsValue * tonUsd / phasePrice : 0
  const quoteTime = quote?.timestamp ? new Date(quote.timestamp).toLocaleTimeString() : ''
  return <section className="inner-page market-sale-page">
    <div className="market-buy-header">
      <div className="market-buy-brand"><div className="market-buy-logo"><Flame size={25} fill="currentColor" /></div><div><b>ARNOLD</b><span>{t('OFFICIAL TOKEN SALE')}</span></div></div>
      <div className="market-live-price"><span className={quote ? 'market-live-dot' : 'market-live-dot market-live-dot-off'} />{quote ? '$' + phasePrice.toFixed(quote.active_phase === 1 ? 3 : 4) : '—'}<small>USD / ARNOLD</small></div>
    </div>
        <div className="market-feature-art">
      <img
        className="market-feature-image"
        src="https://azure-high-cougar-588.mypinata.cloud/ipfs/bafybeicjfptyteaxsypwtluvhwgfhrugekpqt6jfgtbar43o26474ab57m"
        alt="ARNOLD Market"
        loading="lazy"
        decoding="async"
      />
    </div>
<section className="market-buy-card">
      <div className="market-buy-title"><span>{t('COMPRA $ARNOLD')}</span><small>{quote ? t('FASE') + ' ' + activePhase + ' ' + t('ACTIVA') : t('VENTA EN PREPARACIÓN')}</small></div>
      <label className="market-amount-label" htmlFor="arnold-gram-amount">{t('Cantidad a comprar en GRAM')}</label>
      <div className="market-amount-input"><input id="arnold-gram-amount" type="number" min="1" step="0.000000001" inputMode="decimal" value={grams} onChange={event => setGrams(event.target.value)} aria-describedby="arnold-gram-help" /><span>GRAM</span></div>
      <p id="arnold-gram-help" className="market-quote-note">{t('Mínimo 1 GRAM. Escribe cualquier cantidad igual o superior; los botones son solo accesos rápidos.')}</p>
      <div className="market-quick-amounts">{[1,3,5,10,50].map(amount => <button type="button" key={amount} className={Number(grams) === amount ? 'active' : ''} onClick={() => setGrams(String(amount))}>{amount}</button>)}</div>
      <div className="market-quote-rows">
        <div><span>{t('Pagas')}</span><b>{grams || '0'} GRAM</b></div>
        <div><span>{t('Precio actual de GRAM')}</span><b>{quote ? '$' + tonUsd.toFixed(4) + ' USD' : '—'}</b></div>
        <div><span>{t('Precio de ARNOLD')}</span><b>{quote ? '$' + phasePrice.toFixed(4) + ' USD' : '—'}</b></div>
        <div className="market-receive-row"><span>{t('Recibirías aproximadamente')}</span><b>{quote ? Math.floor(estimatedTokens).toLocaleString() + ' $ARNOLD' : '—'}</b></div>
      </div>
      <p className="market-quote-note">{quoteLoading ? t('Consultando cotización…') : quote ? t('Cotización actualizada ') + quoteTime + ' · ' + quote.source + '. ' + t('Se actualiza automáticamente cada 30 segundos. El cálculo definitivo se fija al crear la orden.') : t(quoteError)}</p>
      <button className="market-connect-btn" type="button" onClick={onConnect} disabled={!!walletAddress}>
        <Wallet size={18} /> {walletAddress ? t('BILLETERA CONECTADA') : t('CONECTAR BILLETERA')}
      </button>
      <button className={quote?.purchases_enabled && !(activeOrder && paymentSubmitted) && !purchaseBusy && !recoveringOrder ? 'market-buy-btn market-buy-btn-active' : 'market-buy-btn'} type="button" disabled={purchaseBusy || recoveringOrder || (!!activeOrder && paymentSubmitted) || quoteLoading || !quote?.purchases_enabled} onClick={() => void startPurchase()}>
        <ShoppingBag size={17} /> {purchaseBusy ? t('PROCESANDO…') : recoveringOrder ? t('COMPROBANDO COMPRA…') : activeOrder && paymentSubmitted ? t('COMPRA EN VERIFICACIÓN…') : activeOrder ? 'CONTINUAR PAGO' : quote?.purchases_enabled ? t('BUY $ARNOLD') : t('COMPRAS TODAVÍA CERRADAS')}
      </button>
      <button className="market-recovery-btn" type="button" disabled={!recoveryAvailable || purchaseBusy || !activeOrder} onClick={() => void verifyOrder()}>
        <ShieldCheck size={16} /> {purchaseBusy ? t('VERIFICANDO…') : t('RECUPERAR / VERIFICAR ENTREGA')}
      </button>
      {purchaseMessage && <p className="market-quote-note" role="status">{purchaseMessage}</p>}
      {purchaseError && <p className="market-quote-note" role="alert">{purchaseError}</p>}
      {activeOrder && <p className="market-buy-footnote">Orden {activeOrder.order_id.slice(0, 8)} · {activeOrder.arnold_amount} $ARNOLD · pago: {paymentStatus} · entrega: {payoutStatus}.</p>}
      <p className="market-buy-footnote">{walletAddress ? t('Billetera conectada. La compra solo solicitará la cantidad exacta que confirmes en tu wallet.') : t('Conecta tu billetera para comprar GRAM desde 1. Puedes introducir cualquier importe o usar los paquetes sugeridos.')}</p>
    </section>
    <button className="sale-allocation-toggle" type="button" onClick={() => setShowSalePhases(value => !value)} aria-expanded={showSalePhases}>
      <span>{t('ASIGNACIÓN TOTAL DE VENTA')}</span>
      <strong>200,000 <small>$ARNOLD</small></strong>
      <span className="sale-allocation-action">{showSalePhases ? t('OCULTAR FASES') : t('VER FASES Y PRECIO STON.FI')} <b>{showSalePhases ? '−' : '+'}</b></span>
    </button>
    {showSalePhases && <>
      <div className="market-phases-heading"><b>{t('FASES DE LA VENTA')}</b><span>{t('PROGRESIÓN AUTOMÁTICA')}</span></div>
      <div className="sale-phase-list">
        {phases.map((phase) => <article className={phase.number === activePhase ? 'sale-phase-card sale-phase-first' : 'sale-phase-card'} key={phase.number}>
          <div className="sale-phase-top"><span>{t('FASE')} {phase.number}</span><small>{phase.number === activePhase ? t('FASE ACTUAL') : phase.number < activePhase ? t('FASE ANTERIOR') : phase.number === 4 ? t('FASE FINAL') : t('SIGUIENTE FASE')}</small></div>
          <div className="sale-phase-price">{'$' + phase.price}<span>USD / ARNOLD</span></div>
          <div className="sale-phase-allocation"><span>{t('ASIGNACIÓN DE FASE')}</span><b>{phase.amount} $ARNOLD</b></div>
        </article>)}
      </div>
      <div className="listing-estimate">
        <div className="listing-estimate-label">{t('PRECIO ESTIMADO DE LISTADO')}</div>
        <strong>$0.01 <small>USD</small></strong>
        <b>STON.fi</b>
        <p>{t('Referencia estimada, no representa un precio garantizado ni una promesa de listado.')}</p>
      </div>
      <div className="sale-automation-note"><ShieldCheck size={17} /><p>{t('La siguiente fase se activará automáticamente cuando se vendan y confirmen los 50,000 tokens de la fase actual.')}</p></div>
    </>}
    <div className="sale-security-note"><ShieldCheck size={15} /><span>{t('La compra se inicia únicamente desde una orden activa y requiere confirmación de pago en la red antes de entregar los $ARNOLD.')}</span></div>
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
    if (!WebApp.initData) throw new Error(t('Abre ARNOLD desde el bot oficial de Telegram.'))
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
  const changeLanguage = (next: LanguageCode) => { localStorage.setItem('arnold-language', next); setLanguage(next); document.documentElement.lang = next; document.documentElement.dir = 'ltr' }
  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = 'ltr'
    try { WebApp.ready(); WebApp.expand(); WebApp.setHeaderColor('#090909'); WebApp.setBackgroundColor('#090909') } catch { /* Browser preview */ }
  }, [])

  return <main className="app-shell">
    <div className="glow glow-a" /><div className="glow glow-b" />
    <Header language={language} onLanguageChange={changeLanguage} />
    <div className="content">
      {tab === 'mining' && <MiningPage t={t} onOpenReferrals={() => setTab('referrals')} onOpenWallet={() => setTab('wallet')} miningStatus={miningStatus} onStartMining={() => { void runMiningAction('start') }} onClaimMining={() => { void runMiningAction('claim') }} miningBusy={miningBusy} />}
      {tab === 'tasks' && <TasksPage t={t} />}
      {tab === 'referrals' && <ReferralsPage t={t} />}
      {tab === 'wallet' && <WalletPage t={t} walletAddress={walletAddress} walletReady={walletReady} onConnect={connectWallet} onDisconnect={disconnectWallet} onReconnect={() => { void reconnectWallet() }} onRefreshBalance={refreshBalance} onVerifyPayment={verifyWalletPayment} walletAppName={walletAppName} paymentState={paymentState} arnoldBalance={arnoldBalance} balanceLoading={balanceLoading} balanceError={balanceError} />}
      {tab === 'market' && <MarketPage t={t} walletAddress={walletAddress} onConnect={connectWallet} tonConnect={tonConnect.current} />}
      {tab === 'p2p' && <P2PPage t={t} />}
    </div>
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'selected' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id) }}>
        <Icon size={18} strokeWidth={tab === id ? 2.4 : 1.8} /><span>{t(label)}</span>
      </button>)}
    </nav>
  </main>
}
