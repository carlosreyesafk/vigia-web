# 🛰️ Vigía Web

Monitoreo 24/7 de **uptime + certificado SSL** para pymes, agencias y freelancers.
Si tu sitio se cae o el SSL está por vencer, te enteras en minutos — en el dashboard
y por Telegram. El plan premium se paga en **crypto (USDT en Tron)**, verificado
on-chain, sin procesadores, sin KYC, sin cuentas.

Operado por **Chachi** · Santo Domingo, RD.

## Planes

| | GRATIS | PREMIUM |
|---|---|---|
| Sitios | 3 | 20 |
| Frecuencia de chequeo | cada hora | cada 5 min |
| Alertas Telegram | ✅ | ✅ |
| Historial 30 días | ✅ | ✅ |
| Precio | US$0 | **US$9/mes en USDT (TRC20)** |

## Cómo funciona el cobro crypto

1. El dashboard muestra la wallet `PREMIUM_WALLET` y el monto (9 USDT, red Tron).
2. El usuario envía los USDT y pega el **hash de la transacción**.
3. `POST /api/premium` consulta la **Tronscan API pública** y confirma:
   el hash existe, está confirmado, el destino es la wallet configurada,
   el token es USDT y el monto ≥ precio. El hash queda registrado (no reutilizable).
4. Se activa `plan='premium'` + `premium_until = +30 días` para todos sus sitios.

No se genera ni se guarda ninguna clave privada: la app solo **lee** la cadena.

## Arquitectura

```
public/            landing + dashboard (HTML/CSS/JS vanilla, sin build)
api/
  health.js        estado del servicio y de la DB
  sites.js         CRUD de sitios (límite gratis 3 / premium 20)
  check.js         monitoreo masivo — lo corre Vercel Cron cada hora
  checknow.js      chequeo manual inmediato de un sitio (rate-limit 5 min)
  premium.js       info del plan + verificación on-chain del pago
lib/
  monitor.js       probe HTTP(S): status, ms, días restantes del SSL
  crypto.js        verificación USDT-TRC20 vía Tronscan
  telegram.js      alertas (opcional)
  db.js            cliente PostgREST (service_role, solo server-side)
sql/schema.sql     tablas vigia_* (aplicar una vez en Supabase)
vercel.json        cron: /api/check cada hora
```

**Estados por sitio:** 🟢 `OK` · 🔴 `DOWN` (error de red/timeout o HTTP ≥ 500) ·
🟡 `SSL_SOON` (responde pero el certificado vence en ≤ 14 días o ya venció).

## Despliegue

### 1. Base de datos (Supabase)
Pega `sql/schema.sql` en el SQL editor del proyecto y ejecútalo. Crea
`vigia_sites`, `vigia_checks`, `vigia_payments` (no toca tablas existentes).

### 2. Vercel
Conecta este repo. Variables de entorno:

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | service_role (solo la usan las functions) |
| `CRON_SECRET` | secreto aleatorio (Vercel Cron lo envía como Bearer) |
| `ADMIN_KEY` | para disparar `/api/check?key=...` manualmente |
| `PREMIUM_WALLET` | dirección Tron que recibe los USDT (placeholder hasta configurarla) |
| `PREMIUM_PRICE_USD` | `9` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | opcionales: alertas globales |

El cron de `vercel.json` corre `/api/check` 1 vez al día en producción
(límite del plan Hobby de Vercel: los crons horarios requieren Pro).
Para cumplir la frecuencia prometida, la VM dispara el mismo endpoint:
cron horario (plan gratis) + cron cada 5 min (sitios premium) — ver `ficha.md`.
Si el proyecto sube a Pro, basta cambiar el schedule a `0 * * * *`.

### 3. Probar
- `GET /api/health` → `{"tables": true, ...}`
- Agrega un sitio en el dashboard y pulsa **⚡ Chequear ahora**.
- Dispara el cron manual: `GET /api/check?key=<ADMIN_KEY>`.

## Notas honestas

- En el plan Hobby de Vercel, los crons están limitados a 1/día (la API
  rechazó `0 * * * *` con `cron_jobs_limits_reached`). Por eso la frecuencia
  real la dan dos crons de la VM (`vigia-web-check-hourly` y
  `vigia-web-check-premium-5m`) que disparan `/api/check`; el cron de Vercel
  queda como respaldo diario. El chequeo gratis por hora funciona desde el día 1.
- `PREMIUM_WALLET` es placeholder hasta que se configure la wallet real de cobro.
