// POST /api/checknow — chequeo inmediato de UN sitio del usuario (rate-limit 5 min).
// Body: {owner_email, site_id}
const db = require("../lib/db");
const { checkSite } = require("../lib/monitor");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_GAP_MIN = 5;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "método no permitido" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const owner = String(body.owner_email || "").trim().toLowerCase();
    const siteId = String(body.site_id || "").trim();
    if (!EMAIL_RE.test(owner) || !siteId) return res.status(400).json({ error: "parámetros inválidos" });

    const sites = await db.get(`/vigia_sites?id=eq.${encodeURIComponent(siteId)}&owner_email=eq.${encodeURIComponent(owner)}&select=id,url,label,last_checked_at&limit=1`);
    if (!sites || !sites.length) return res.status(404).json({ error: "sitio no encontrado" });
    const site = sites[0];
    if (site.last_checked_at && (Date.now() - new Date(site.last_checked_at).getTime()) / 60000 < MIN_GAP_MIN) {
      return res.status(429).json({ error: `espera ${MIN_GAP_MIN} minutos entre chequeos manuales` });
    }

    const check = await checkSite(site.url);
    await db.post("/vigia_checks", {
      site_id: site.id, ok: check.ok, status: check.status, status_code: check.statusCode,
      response_ms: check.responseMs, ssl_days_left: check.sslDaysLeft, error: check.error,
    });
    await db.patch(`/vigia_sites?id=eq.${site.id}`, { last_status: check.status, last_checked_at: new Date().toISOString() });
    return res.status(200).json({ check });
  } catch (e) {
    if (e.missingTable) return res.status(503).json({ error: "base de datos sin inicializar: ejecuta sql/schema.sql en Supabase" });
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
