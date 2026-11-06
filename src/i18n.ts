export const languages = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'id', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'th', name: 'ไทย', flag: '🇹🇭' },
] as const

export type LanguageCode = typeof languages[number]['code']

const translations: Record<string, Record<string, string>> = {
  en: {},
  es: {
    Mining: 'Minería', Tasks: 'Tareas', Referrals: 'Referidos', Wallet: 'Billetera', Market: 'Mercado',
    'THE DAILY GRIND': 'MINERÍA DIARIA', 'MAKE YOUR': 'HAZ QUE TUS', HOLDINGS: 'TOKENS', WORK: 'TRABAJEN',
    'Mine $ARNOLD every 24 hours. Stay active, stack rewards.': 'Mina $ARNOLD cada 24 horas. Mantente activo y acumula recompensas.',
    'BASE REWARD': 'RECOMPENSA BASE', CYCLE: 'CICLO', HOURS: 'HORAS',
    'Per completed 24-hour cycle': 'Por cada ciclo completado de 24 horas',
    'One manual cycle at a time': 'Un ciclo manual a la vez',
    'MINING STATION': 'ESTACIÓN DE MINERÍA', 'MINING SESSION': 'SESIÓN DE MINERÍA',
    'NOT ACTIVE': 'NO ACTIVA', 'MINING WILL OPEN SOON': 'LA MINERÍA ABRIRÁ PRONTO',
    'BASE CYCLE REWARD': 'RECOMPENSA BASE DEL CICLO',
    'Initial reward before holding bonuses': 'Recompensa inicial antes de bonificaciones por saldo',
    'MINING COMING SOON': 'MINERÍA PRÓXIMAMENTE',
    'Mining remains disabled until all security checks are completed.': 'La minería seguirá desactivada hasta completar todas las verificaciones de seguridad.',
    'Total supply: 1,000,000 $ARNOLD · Mining allocation: 500,000 $ARNOLD': 'Suministro total: 1,000,000 $ARNOLD · Reserva de minería: 500,000 $ARNOLD',
    'EARN MORE $ARNOLD': 'GANA MÁS $ARNOLD', 'DAILY': 'TAREAS', 'TASKS.': 'DIARIAS.',
    'REWARD TASKS': 'TAREAS CON RECOMPENSA', 'Complete activities to earn additional rewards.': 'Completa actividades para ganar recompensas adicionales.',
    'TASKS COMING SOON': 'TAREAS PRÓXIMAMENTE', 'Available tasks and their rewards will be published here.': 'Aquí se publicarán las tareas disponibles y sus recompensas.',
    'GROW THE COMMUNITY': 'HAZ CRECER LA COMUNIDAD', 'INVITE.': 'INVITA.', 'EARN.': 'GANA.',
    '5% LIFETIME REFERRAL REWARD': '5% DE RECOMPENSA DE REFERIDOS DE POR VIDA',
    'YOUR REFERRALS': 'TUS REFERIDOS', 'PENDING REWARDS': 'RECOMPENSAS PENDIENTES',
    'REFERRAL DASHBOARD SOON': 'PANEL DE REFERIDOS PRÓXIMAMENTE',
    'YOUR TON ACCOUNT': 'TU CUENTA TON', 'YOUR WALLET.': 'TU BILLETERA.',
    'TON WALLET': 'BILLETERA TON', 'WALLET CONNECT COMING SOON': 'CONEXIÓN DE BILLETERA PRÓXIMAMENTE',
    'Minimum balance for withdrawals': 'Saldo mínimo para retiros', 'Minimum withdrawal': 'Retiro mínimo',
    'One-time verification': 'Verificación única', 'OFFICIAL ARNOLD STORE': 'TIENDA OFICIAL ARNOLD',
    'THE MARKET.': 'EL MERCADO.', 'BUY $ARNOLD DIRECTLY': 'COMPRA $ARNOLD DIRECTAMENTE',
    'OFFICIAL MARKET COMING SOON': 'MERCADO OFICIAL PRÓXIMAMENTE',
    'PEER-TO-PEER TRADING': 'COMERCIO ENTRE USUARIOS', 'MARKET.': 'MERCADO.',
    'COMING SOON': 'PRÓXIMAMENTE', 'P2P TRADING IS NOT ACTIVE': 'EL COMERCIO P2P NO ESTÁ ACTIVO',
    'EARLY BUILD · LIVE FEATURES DISABLED': 'VERSIÓN INICIAL · FUNCIONES DESACTIVADAS',
  },
  id: { Mining:'Penambangan', Tasks:'Tugas', Referrals:'Referral', Wallet:'Dompet', Market:'Pasar', 'NOT ACTIVE':'BELUM AKTIF', 'COMING SOON':'SEGERA HADIR', 'MINING COMING SOON':'PENAMBANGAN SEGERA HADIR', 'BASE REWARD':'HADIAH DASAR', CYCLE:'SIKLUS', 'MINING SESSION':'SESI PENAMBANGAN', 'YOUR WALLET.':'DOMPET ANDA.', 'THE MARKET.':'PASAR.', 'TASKS COMING SOON':'TUGAS SEGERA HADIR', 'EARLY BUILD · LIVE FEATURES DISABLED':'VERSI AWAL · FITUR DINONAKTIFKAN' },
  ru: { Mining:'Майнинг', Tasks:'Задания', Referrals:'Рефералы', Wallet:'Кошелёк', Market:'Маркет', 'NOT ACTIVE':'НЕ АКТИВНО', 'COMING SOON':'СКОРО', 'MINING COMING SOON':'МАЙНИНГ СКОРО', 'BASE REWARD':'БАЗОВАЯ НАГРАДА', CYCLE:'ЦИКЛ', 'MINING SESSION':'СЕССИЯ МАЙНИНГА', 'YOUR WALLET.':'ВАШ КОШЕЛЁК.', 'THE MARKET.':'МАРКЕТ.', 'TASKS COMING SOON':'ЗАДАНИЯ СКОРО', 'EARLY BUILD · LIVE FEATURES DISABLED':'РАННЯЯ ВЕРСИЯ · ФУНКЦИИ ОТКЛЮЧЕНЫ' },
  ko: { Mining:'채굴', Tasks:'작업', Referrals:'추천', Wallet:'지갑', Market:'마켓', 'NOT ACTIVE':'비활성', 'COMING SOON':'출시 예정', 'MINING COMING SOON':'채굴 준비 중', 'BASE REWARD':'기본 보상', CYCLE:'주기', 'MINING SESSION':'채굴 세션', 'YOUR WALLET.':'내 지갑.', 'THE MARKET.':'마켓.', 'TASKS COMING SOON':'작업 준비 중', 'EARLY BUILD · LIVE FEATURES DISABLED':'초기 버전 · 기능 비활성화' },
  'zh-CN': { Mining:'挖矿', Tasks:'任务', Referrals:'推荐', Wallet:'钱包', Market:'市场', 'NOT ACTIVE':'未启用', 'COMING SOON':'即将推出', 'MINING COMING SOON':'挖矿即将开放', 'BASE REWARD':'基础奖励', CYCLE:'周期', 'MINING SESSION':'挖矿会话', 'YOUR WALLET.':'我的钱包', 'THE MARKET.':'市场', 'TASKS COMING SOON':'任务即将推出', 'EARLY BUILD · LIVE FEATURES DISABLED':'早期版本 · 功能尚未启用' },
  'zh-TW': { Mining:'挖礦', Tasks:'任務', Referrals:'推薦', Wallet:'錢包', Market:'市場', 'NOT ACTIVE':'未啟用', 'COMING SOON':'即將推出', 'MINING COMING SOON':'挖礦即將開放', 'BASE REWARD':'基本獎勵', CYCLE:'週期', 'MINING SESSION':'挖礦時段', 'YOUR WALLET.':'我的錢包', 'THE MARKET.':'市場', 'TASKS COMING SOON':'任務即將推出', 'EARLY BUILD · LIVE FEATURES DISABLED':'早期版本 · 功能尚未啟用' },
  pt: { Mining:'Mineração', Tasks:'Tarefas', Referrals:'Indicações', Wallet:'Carteira', Market:'Mercado', 'NOT ACTIVE':'INATIVO', 'COMING SOON':'EM BREVE', 'MINING COMING SOON':'MINERAÇÃO EM BREVE', 'BASE REWARD':'RECOMPENSA BASE', CYCLE:'CICLO', 'MINING SESSION':'SESSÃO DE MINERAÇÃO', 'YOUR WALLET.':'SUA CARTEIRA.', 'THE MARKET.':'O MERCADO.', 'TASKS COMING SOON':'TAREFAS EM BREVE', 'EARLY BUILD · LIVE FEATURES DISABLED':'VERSÃO INICIAL · RECURSOS DESATIVADOS' },
  fr: { Mining:'Minage', Tasks:'Tâches', Referrals:'Parrainage', Wallet:'Portefeuille', Market:'Marché', 'NOT ACTIVE':'INACTIF', 'COMING SOON':'BIENTÔT', 'MINING COMING SOON':'MINAGE BIENTÔT', 'BASE REWARD':'RÉCOMPENSE DE BASE', CYCLE:'CYCLE', 'MINING SESSION':'SESSION DE MINAGE', 'YOUR WALLET.':'VOTRE PORTEFEUILLE.', 'THE MARKET.':'LE MARCHÉ.', 'TASKS COMING SOON':'TÂCHES BIENTÔT', 'EARLY BUILD · LIVE FEATURES DISABLED':'VERSION INITIALE · FONCTIONS DÉSACTIVÉES' },
  de: { Mining:'Mining', Tasks:'Aufgaben', Referrals:'Empfehlungen', Wallet:'Wallet', Market:'Markt', 'NOT ACTIVE':'NICHT AKTIV', 'COMING SOON':'DEMNÄCHST', 'MINING COMING SOON':'MINING FOLGT BALD', 'BASE REWARD':'BASISBELOHNUNG', CYCLE:'ZYKLUS', 'MINING SESSION':'MINING-SITZUNG', 'YOUR WALLET.':'DEINE WALLET.', 'THE MARKET.':'DER MARKT.', 'TASKS COMING SOON':'AUFGABEN FOLGEN BALD', 'EARLY BUILD · LIVE FEATURES DISABLED':'FRÜHE VERSION · FUNKTIONEN DEAKTIVIERT' },
  tr: { Mining:'Madencilik', Tasks:'Görevler', Referrals:'Referanslar', Wallet:'Cüzdan', Market:'Pazar', 'NOT ACTIVE':'AKTİF DEĞİL', 'COMING SOON':'YAKINDA', 'MINING COMING SOON':'MADENCİLİK YAKINDA', 'BASE REWARD':'TEMEL ÖDÜL', CYCLE:'DÖNGÜ', 'MINING SESSION':'MADENCİLİK OTURUMU', 'YOUR WALLET.':'CÜZDANINIZ.', 'THE MARKET.':'PAZAR.', 'TASKS COMING SOON':'GÖREVLER YAKINDA', 'EARLY BUILD · LIVE FEATURES DISABLED':'ERKEN SÜRÜM · ÖZELLİKLER DEVRE DIŞI' },
  vi: { Mining:'Đào coin', Tasks:'Nhiệm vụ', Referrals:'Giới thiệu', Wallet:'Ví', Market:'Thị trường', 'NOT ACTIVE':'CHƯA HOẠT ĐỘNG', 'COMING SOON':'SẮP RA MẮT', 'MINING COMING SOON':'SẮP MỞ ĐÀO COIN', 'BASE REWARD':'PHẦN THƯỞNG CƠ BẢN', CYCLE:'CHU KỲ', 'MINING SESSION':'PHIÊN ĐÀO COIN', 'YOUR WALLET.':'VÍ CỦA BẠN.', 'THE MARKET.':'THỊ TRƯỜNG.', 'TASKS COMING SOON':'NHIỆM VỤ SẮP RA MẮT', 'EARLY BUILD · LIVE FEATURES DISABLED':'BẢN ĐẦU · TÍNH NĂNG ĐÃ TẮT' },
  hi: { Mining:'माइनिंग', Tasks:'कार्य', Referrals:'रेफ़रल', Wallet:'वॉलेट', Market:'बाज़ार', 'NOT ACTIVE':'सक्रिय नहीं', 'COMING SOON':'जल्द आ रहा है', 'MINING COMING SOON':'माइनिंग जल्द शुरू होगी', 'BASE REWARD':'आधार इनाम', CYCLE:'चक्र', 'MINING SESSION':'माइनिंग सत्र', 'YOUR WALLET.':'आपका वॉलेट', 'THE MARKET.':'बाज़ार', 'TASKS COMING SOON':'कार्य जल्द आ रहे हैं', 'EARLY BUILD · LIVE FEATURES DISABLED':'शुरुआती संस्करण · सुविधाएँ बंद हैं' },
  ar: { Mining:'التعدين', Tasks:'المهام', Referrals:'الإحالات', Wallet:'المحفظة', Market:'السوق', 'NOT ACTIVE':'غير نشط', 'COMING SOON':'قريباً', 'MINING COMING SOON':'التعدين قريباً', 'BASE REWARD':'المكافأة الأساسية', CYCLE:'الدورة', 'MINING SESSION':'جلسة التعدين', 'YOUR WALLET.':'محفظتك', 'THE MARKET.':'السوق', 'TASKS COMING SOON':'المهام قريباً', 'EARLY BUILD · LIVE FEATURES DISABLED':'نسخة أولية · الميزات معطلة' },
  ja: { Mining:'マイニング', Tasks:'タスク', Referrals:'紹介', Wallet:'ウォレット', Market:'マーケット', 'NOT ACTIVE':'停止中', 'COMING SOON':'近日公開', 'MINING COMING SOON':'マイニング近日公開', 'BASE REWARD':'基本報酬', CYCLE:'サイクル', 'MINING SESSION':'マイニングセッション', 'YOUR WALLET.':'ウォレット', 'THE MARKET.':'マーケット', 'TASKS COMING SOON':'タスク近日公開', 'EARLY BUILD · LIVE FEATURES DISABLED':'初期版 · 機能は無効です' },
  th: { Mining:'ขุดเหรียญ', Tasks:'ภารกิจ', Referrals:'แนะนำเพื่อน', Wallet:'กระเป๋า', Market:'ตลาด', 'NOT ACTIVE':'ยังไม่เปิดใช้งาน', 'COMING SOON':'เร็ว ๆ นี้', 'MINING COMING SOON':'ระบบขุดจะเปิดเร็ว ๆ นี้', 'BASE REWARD':'รางวัลพื้นฐาน', CYCLE:'รอบ', 'MINING SESSION':'รอบการขุด', 'YOUR WALLET.':'กระเป๋าของคุณ', 'THE MARKET.':'ตลาด', 'TASKS COMING SOON':'ภารกิจเร็ว ๆ นี้', 'EARLY BUILD · LIVE FEATURES DISABLED':'เวอร์ชันเริ่มต้น · ปิดฟีเจอร์ไว้' },
}

export function detectLanguage(): LanguageCode {
  const saved = localStorage.getItem('arnold-language')
  if (languages.some((item) => item.code === saved)) return saved as LanguageCode
  const telegramLang = (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.language_code
  const browserLang = telegramLang || navigator.language || 'en'
  if (browserLang.toLowerCase().startsWith('zh-tw') || browserLang.toLowerCase().startsWith('zh-hk')) return 'zh-TW'
  const match = languages.find((item) => browserLang.toLowerCase().startsWith(item.code.toLowerCase().split('-')[0]))
  return match?.code || 'en'
}

export function translate(language: LanguageCode, phrase: string): string {
  return translations[language]?.[phrase] || phrase
}
