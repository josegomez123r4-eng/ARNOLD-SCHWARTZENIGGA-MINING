# Despliegue manual de ARNOLD

Esta rama es `feature/arnold-four-phase-sale`. No se ha desplegado a producción desde este cambio.

## 1. Frontend en Vercel

El proyecto es una aplicación Vite. Vercel debe usar:

- Framework preset: Vite
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Pasos:
1. Abre el proyecto ARNOLD en Vercel.
2. En Deployments, selecciona **Create Deployment** (o importa el repositorio si aún no está conectado).
3. Selecciona el repositorio `josegomez123r4-eng/ARNOLD-SCHWARTZENIGGA-MINING` y la rama `feature/arnold-four-phase-sale`.
4. Comprueba la configuración de Vite indicada arriba y despliega como **Preview**, no Production, para revisar primero.
5. No agregues frases semilla, claves privadas, service-role keys ni tokens de trabajador a las variables de Vercel.

El archivo `vercel.json` incluido configura la ruta de fallback de la SPA.

## 2. Importante: backend separado

Vercel despliega el frontend web. Las funciones de base de datos/TON son **Supabase Edge Functions** y no se despliegan desde Vercel. Deben publicarse manualmente en el proyecto Supabase de producción `vnslzfivilgdqqgdyoxd`, desde un equipo con Supabase CLI:

```bash
supabase login
supabase link --project-ref vnslzfivilgdqqgdyoxd
supabase functions deploy arnold-sale --no-verify-jwt
supabase functions deploy arnold-payout --no-verify-jwt
supabase functions deploy arnold-payout-reconcile --no-verify-jwt
supabase functions deploy arnold-treasury-check --no-verify-jwt
```

Ejecuta estos comandos desde la raíz del repositorio y con esta rama descargada. No ejecutes migraciones otra vez: las migraciones de venta ya fueron aplicadas al proyecto indicado.

## 3. Secretos de Supabase

Configúralos en **Supabase Dashboard → Project Settings → Edge Functions → Secrets**. No los pongas en Vercel ni en GitHub:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `ARNOLD_PAYOUT_WORKER_TOKEN`
- `ARNOLD_TREASURY_MNEMONIC`
- `ARNOLD_DECIMALS` (debe coincidir con los decimales reales del Jetton ARNOLD)
- `TONCENTER_API_KEY` (si se utiliza cuota autenticada)
- `TONAPI_KEY` (si se utiliza cuota autenticada)
- `ARNOLD_TREASURY_CHECK_TOKEN` (para el endpoint privado de comprobación)

Los valores deben introducirse directamente en Supabase. Nunca los compartas por chat, commits, capturas o variables públicas `VITE_*`.

## 4. Comprobaciones antes de abrir la venta

- Mantén `ARNOLD_SALE_ENABLED=false` (o sin configurar) durante la revisión.
- Confirma que las cuatro funciones aparecen como ACTIVE en Supabase.
- Comprueba que el endpoint de cotización devuelve las cuatro fases y los importes admitidos.
- Comprueba que el verificador de tesorería devuelve `match: true` sin exponer la frase ni claves privadas.
- Comprueba el balance Jetton de la tesorería y los decimales del master ARNOLD.
- Realiza pruebas de interfaz y de lectura sin emitir transferencias.
- No habilites la venta ni envíes fondos hasta revisar todo lo anterior y autorizar expresamente la apertura.

## 5. Qué no hace este despliegue

Un despliegue Preview de Vercel no publica automáticamente las Edge Functions de Supabase, no mueve tokens, no abre la venta y no garantiza que el flujo de pagos/entregas esté operativo. La verificación de la tesorería y las pruebas de extremo a extremo siguen siendo obligatorias.
