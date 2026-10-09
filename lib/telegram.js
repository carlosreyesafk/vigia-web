// Alertas por Telegram (opcional). Sin token configurado, no hace nada.
async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { sent: false, reason: "telegram no configurado" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    return { sent: res.ok, reason: res.ok ? "ok" : (data.description || `HTTP ${res.status}`) };
  } catch (e) {
    return { sent: false, reason: String(e.message || e).slice(0, 120) };
  }
}

function alertText(site, check) {
  const label = site.label || site.url;
  if (check.status === "DOWN") {
    return `🔴 <b>Vigía Web — CAÍDO</b>\n${label}\n${site.url}\n${check.error || `HTTP ${check.statusCode}`}\n${new Date().toLocaleString("es-DO")}`;
  }
  if (check.status === "SSL_SOON") {
    return `🟡 <b>Vigía Web — SSL por vencer</b>\n${label}\n${site.url}\nCertificado vence en <b>${check.sslDaysLeft} días</b>. Renuévalo antes de que el sitio marque error.\n${new Date().toLocaleString("es-DO")}`;
  }
  return null;
}

module.exports = { sendTelegram, alertText };
