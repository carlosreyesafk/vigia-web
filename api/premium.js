// /api/premium — upgrade a PREMIUM pagado en crypto (USDT en Tron).
// GET  ?owner=<email> → {wallet, priceUsd, plan, premiumUntil, walletReady}
// POST {owner_email, tx_hash} → verifica on-chain y activa 30 días premium.
const db = require("../lib/db");
const { verifyPremiumPayment } = require("../lib/crypto");

const PRICE_USD = Number(process.env.PREMIUM_PRICE_USD || 9);
const DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  const wallet = (process.env.PREMIUM_WALLET || "").trim();
  const walletReady = Boolean(wallet) && !/PLACEHOLDER/i.test(wallet);

  try {
    if (req.method === "GET") {
      const owner = String(req.query.owner || "").trim().toLowerCase();
      let plan = "free", premiumUntil = null;
      if (EMAIL_RE.test(owner)) {
        const rows = await db.get(`/vigia_sites?owner_email=eq.${encodeURIComponent(owner)}&select=plan,premium_until&limit=1`);
        if (rows && rows.length) {
          plan = rows[0].plan;
          premiumUntil = rows[0].premium_until;
          if (!(plan === "premium" && premiumUntil && new Date(premiumUntil) > new Date())) plan = "free";
        }
      }
      return res.status(200).json({
        priceUsd: PRICE_USD, days: DAYS, currency: "USDT", chain: "Tron (TRC20)",
        wallet: walletReady ? wallet : null, walletReady, plan, premiumUntil,
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const owner = String(body.owner_email || "").trim().toLowerCase();
      const txHash = String(body.tx_hash || "").trim();
      if (!EMAIL_RE.test(owner)) return res.status(400).json({ error: "email inválido" });
      if (!walletReady) return res.status(503).json({ error: "cobro crypto aún sin configurar: la wallet se publica pronto" });

      const used = await db.get(`/vigia_payments?tx_hash=eq.${encodeURIComponent(txHash)}&select=id,status`);
      if (used && used.length) return res.status(409).json({ error: "ese hash ya fue usado", status: used[0].status });

      const v = await verifyPremiumPayment({ txHash, wallet, minAmountUsdt: PRICE_USD });
      if (!v.ok) {
        await db.post("/vigia_payments", { owner_email: owner, tx_hash: txHash, chain: "tron", amount_usd: PRICE_USD, status: "rejected" }).catch(() => {});
        return res.status(402).json({ error: `pago no verificado: ${v.reason}` });
      }

      const until = new Date(Date.now() + DAYS * 86400000).toISOString();
      await db.post("/vigia_payments", { owner_email: owner, tx_hash: txHash, chain: "tron", amount_usd: v.amount || PRICE_USD, status: "verified" });
      await db.patch(`/vigia_sites?owner_email=eq.${encodeURIComponent(owner)}`, { plan: "premium", premium_until: until });
      return res.status(200).json({ ok: true, plan: "premium", premiumUntil: until, amount: v.amount });
    }

    return res.status(405).json({ error: "método no permitido" });
  } catch (e) {
    if (e.missingTable) return res.status(503).json({ error: "base de datos sin inicializar: ejecuta sql/schema.sql en Supabase" });
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
