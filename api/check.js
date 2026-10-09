// GET /api/check — corre el monitoreo (Vercel Cron cada hora + disparo manual).
// Auth: header "Authorization: Bearer <CRON_SECRET>" (Vercel Cron lo envía solo)
//       o ?key=<ADMIN_KEY> para disparo manual de prueba.
const db = require("../lib/db");
const { checkSite } = require("../lib/monitor");
const { sendTelegram, alertText } = require("../lib/telegram");

const FREE_INTERVAL_MIN = 60;
const PREMIUM_INTERVAL_MIN = 5;
const ALERT_COOLDOWN_MIN = 60;

function authorized(req) {
  const h = req.headers.authorization || "";
  if (process.env.CRON_SECRET && h === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (process.env.ADMIN_KEY && req.query.key === process.env.ADMIN_KEY) return true;
  return false;
}

function dueSince(site) {
  if (!site.last_checked_at) return true;
  const mins = (Date.now() - new Date(site.last_checked_at).getTime()) / 60000;
  const interval = site.plan === "premium" ? PREMIUM_INTERVAL_MIN : FREE_INTERVAL_MIN;
  return mins >= interval;
}

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "no autorizado" });
  const started = Date.now();
  const summary = { checked: 0, ok: 0, down: 0, sslSoon: 0, alerts: 0, errors: [] };

  try {
    const sites = await db.get("/vigia_sites?select=id,url,label,plan,owner_email,telegram_chat_id,last_status,last_checked_at,last_alert_at&order=last_checked_at.asc.nullsfirst&limit=200");
    const due = (sites || []).filter(dueSince);

    for (const site of due) {
      const check = await checkSite(site.url);
      summary.checked++;
      if (check.status === "OK") summary.ok++;
      else if (check.status === "DOWN") summary.down++;
      else summary.sslSoon++;

      try {
        await db.post("/vigia_checks", {
          site_id: site.id,
          ok: check.ok,
          status: check.status,
          status_code: check.statusCode,
          response_ms: check.responseMs,
          ssl_days_left: check.sslDaysLeft,
          error: check.error,
        });
        // podar historial viejo (30 días)
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        await db.del(`/vigia_checks?site_id=eq.${site.id}&checked_at=lt.${encodeURIComponent(cutoff)}`);
      } catch (e) { summary.errors.push(`db ${site.url}: ${String(e.message).slice(0, 80)}`); }

      // alerta solo en transición a problema (o si pasó el cooldown y sigue mal)
      const wasBad = site.last_status === "DOWN" || site.last_status === "SSL_SOON";
      const isBad = check.status !== "OK";
      const cooldownOk = !site.last_alert_at || (Date.now() - new Date(site.last_alert_at).getTime()) / 60000 >= ALERT_COOLDOWN_MIN;
      let alertedAt = site.last_alert_at;
      if (isBad && (!wasBad || cooldownOk)) {
        const chatId = site.telegram_chat_id || process.env.TELEGRAM_CHAT_ID;
        const text = alertText(site, check);
        if (text) {
          const r = await sendTelegram(chatId, text);
          if (r.sent) { summary.alerts++; alertedAt = new Date().toISOString(); }
          else summary.errors.push(`telegram ${site.url}: ${r.reason}`);
        }
      }

      try {
        await db.patch(`/vigia_sites?id=eq.${site.id}`, {
          last_status: check.status,
          last_checked_at: new Date().toISOString(),
          ...(alertedAt ? { last_alert_at: alertedAt } : {}),
        });
      } catch (e) { summary.errors.push(`upd ${site.url}: ${String(e.message).slice(0, 80)}`); }
    }

    summary.ms = Date.now() - started;
    return res.status(200).json(summary);
  } catch (e) {
    if (e.missingTable) return res.status(503).json({ error: "base de datos sin inicializar: ejecuta sql/schema.sql en Supabase" });
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
