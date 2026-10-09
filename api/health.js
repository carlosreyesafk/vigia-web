// GET /api/health — estado del servicio y de la base de datos.
const db = require("../lib/db");

module.exports = async (req, res) => {
  const out = {
    ok: true,
    service: "vigia-web",
    time: new Date().toISOString(),
    db: "not-configured",
    tables: false,
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    premiumWallet: process.env.PREMIUM_WALLET && !/PLACEHOLDER/i.test(process.env.PREMIUM_WALLET) ? "set" : "placeholder",
  };
  if (!db.configured()) return res.status(200).json(out);
  out.db = "configured";
  try {
    await db.get("/vigia_sites?select=id&limit=1");
    out.tables = true;
  } catch (e) {
    out.tables = false;
    out.dbError = e.missingTable ? "missing-tables: ejecuta sql/schema.sql en Supabase" : String(e.message).slice(0, 160);
  }
  return res.status(200).json(out);
};
