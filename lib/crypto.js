// Verificación on-chain de pagos USDT (TRC20) en Tron vía API pública de Tronscan.
// No genera ni guarda claves: solo LEE la cadena para confirmar que el pago llegó
// a la wallet configurada (PREMIUM_WALLET).
const TRONSCAN = "https://apilist.tronscanapi.com";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT TRC20 (mainnet)
const USDT_DECIMALS = 1e6;

async function tronGet(path) {
  const res = await fetch(`${TRONSCAN}${path}`, {
    headers: { "User-Agent": "VigiaWeb/1.0" },
  });
  if (!res.ok) throw new Error(`Tronscan HTTP ${res.status}`);
  return res.json();
}

// Busca una transferencia USDT hacia la wallet en el historial reciente de la wallet.
// Más robusto que parsear transaction-info (cubre cualquier formato de tx).
async function findUsdtPayment({ wallet, minAmountUsdt, txHash }) {
  // 1) Intentar lookup directo de la transacción
  try {
    const info = await tronGet(`/api/transaction-info?hash=${txHash}`);
    if (info && info.confirmed) {
      const transfers = info.trc20TransferInfo || info.tokenTransferInfo || [];
      const list = Array.isArray(transfers) ? transfers : [transfers];
      for (const t of list) {
        const to = t.to_address || t.toAddress || "";
        const sym = (t.symbol || t.tokenName || "").toUpperCase();
        const amt = Number(t.amount_str || t.amount || 0) / USDT_DECIMALS;
        const contract = t.contract_address || "";
        if (
          to === wallet &&
          (sym === "USDT" || contract === USDT_CONTRACT) &&
          amt >= minAmountUsdt
        ) {
          return { ok: true, amount: amt, method: "tx-lookup" };
        }
      }
    }
  } catch (e) {
    // seguir al plan B
  }
  // 2) Plan B: transferencias TRC20 recientes hacia la wallet
  const data = await tronGet(
    `/api/token_trc20/transfers?relatedAddress=${wallet}&limit=50&contract_address=${USDT_CONTRACT}`
  );
  const transfers = (data && data.token_transfers) || [];
  for (const t of transfers) {
    if (
      (t.transaction_id === txHash || t.hash === txHash) &&
      t.to_address === wallet &&
      Number(t.quant || 0) / USDT_DECIMALS >= minAmountUsdt &&
      t.confirmed !== false
    ) {
      return { ok: true, amount: Number(t.quant) / USDT_DECIMALS, method: "wallet-scan" };
    }
  }
  return { ok: false, reason: "no se encontró una transferencia USDT válida a la wallet con ese hash" };
}

async function verifyPremiumPayment({ txHash, wallet, minAmountUsdt }) {
  if (!txHash || !/^[a-f0-9]{64}$/i.test(txHash.trim())) {
    return { ok: false, reason: "hash de transacción inválido (64 hex)" };
  }
  if (!wallet || /PLACEHOLDER/i.test(wallet)) {
    return { ok: false, reason: "wallet de cobro sin configurar (PREMIUM_WALLET)" };
  }
  try {
    return await findUsdtPayment({ wallet: wallet.trim(), minAmountUsdt, txHash: txHash.trim() });
  } catch (e) {
    return { ok: false, reason: `error consultando Tronscan: ${String(e.message || e).slice(0, 120)}` };
  }
}

module.exports = { verifyPremiumPayment, USDT_CONTRACT };
