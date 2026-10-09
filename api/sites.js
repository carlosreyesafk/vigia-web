// /api/sites — CRUD de sitios monitoreados.
// GET    ?owner=<email>            → lista sitios + último chequeo de cada uno
// POST   {owner_email, url, label?, telegram_chat_id?} → agrega (gratis: máx 3)
// DELETE ?owner=<email>&id=<uuid>  → elimina
const db = require("../lib/db");

const FREE_LIMIT = 3;
const PREMIUM_LIMIT = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("url vacía");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("solo http/https");
  if (parsed.hostname === "localhost" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
    throw new Error("no se monitorean direcciones locales");
  }
  return parsed.toString();
}

async function ownerPlan(owner) {
  const rows = await db.get(`/vigia_sites?owner_email=eq.${encodeURIComponent(owner)}&select=plan,premium_until&limit=1`);
  if (!rows || !rows.length) return { plan: "free", premiumUntil: null };
  const r = rows[0];
  const active = r.plan === "premium" && r.premium_until && new Date(r.premium_until) > new Date();
  return { plan: active ? "premium" : "free", premiumUntil: r.premium_until };
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const owner = String(req.query.owner || "").trim().toLowerCase();
      if (!EMAIL_RE.test(owner)) return res.status(400).json({ error: "owner inválido" });
      const sites = await db.get(
        `/vigia_sites?owner_email=eq.${encodeURIComponent(owner)}&select=id,url,label,plan,last_status,last_checked_at,created_at,premium_until,telegram_chat_id&order=created_at.asc`
      );
      // último chequeo por sitio (para el historial del dashboard)
      const out = [];
      for (const s of sites || []) {
        let history = [];
        try {
          history = await db.get(
            `/vigia_checks?site_id=eq.${s.id}&select=checked_at,ok,status,status_code,response_ms,ssl_days_left&order=checked_at.desc&limit=24`
          );
        } catch { /* tabla puede no existir aún */ }
        out.push({ ...s, history: (history || []).reverse() });
      }
      const { plan, premiumUntil } = await ownerPlan(owner);
      return res.status(200).json({ sites: out, plan, premiumUntil, limits: { free: FREE_LIMIT, premium: PREMIUM_LIMIT } });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const owner = String(body.owner_email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(owner)) return res.status(400).json({ error: "email inválido" });
      let url;
      try { url = normUrl(body.url); } catch (e) { return res.status(400).json({ error: e.message }); }
      const label = String(body.label || "").trim().slice(0, 80) || null;
      const tg = String(body.telegram_chat_id || "").trim().slice(0, 40) || null;

      const { plan } = await ownerPlan(owner);
      const limit = plan === "premium" ? PREMIUM_LIMIT : FREE_LIMIT;
      const existing = await db.get(`/vigia_sites?owner_email=eq.${encodeURIComponent(owner)}&select=id`);
      if ((existing || []).length >= limit) {
        return res.status(402).json({ error: `límite del plan ${plan} alcanzado (${limit} sitios)`, upgrade: plan === "free" });
      }
      const dup = await db.get(`/vigia_sites?owner_email=eq.${encodeURIComponent(owner)}&url=eq.${encodeURIComponent(url)}&select=id`);
      if (dup && dup.length) return res.status(409).json({ error: "ese sitio ya está agregado" });

      const created = await db.post("/vigia_sites", {
        owner_email: owner, url, label, plan, telegram_chat_id: tg,
      });
      return res.status(201).json({ site: (created || [])[0] || null });
    }

    if (req.method === "DELETE") {
      const owner = String(req.query.owner || "").trim().toLowerCase();
      const id = String(req.query.id || "").trim();
      if (!EMAIL_RE.test(owner) || !id) return res.status(400).json({ error: "parámetros inválidos" });
      await db.del(`/vigia_sites?id=eq.${encodeURIComponent(id)}&owner_email=eq.${encodeURIComponent(owner)}`);
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "método no permitido" });
  } catch (e) {
    if (e.missingTable) return res.status(503).json({ error: "base de datos sin inicializar: ejecuta sql/schema.sql en Supabase" });
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
