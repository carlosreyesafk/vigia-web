const $ = (id) => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};
const email = () => ($("email").value || "").trim().toLowerCase();
const savedEmail = () => localStorage.getItem("vigia_email") || "";

const PILL = { OK: ["ok", "🟢 OK"], DOWN: ["down", "🔴 CAÍDO"], SSL_SOON: ["warn", "🟡 SSL POR VENCER"] };

function pill(status) {
  if (!status) return `<span class="pill idle">⚪ SIN CHEQUEAR</span>`;
  const [cls, txt] = PILL[status] || ["idle", status];
  return `<span class="pill ${cls}">${txt}</span>`;
}

function dots(history) {
  if (!history || !history.length) return `<span class="muted small">sin historial aún</span>`;
  return history.map((h) => {
    const c = h.status === "OK" ? "ok" : h.status === "DOWN" ? "down" : "warn";
    const t = new Date(h.checked_at).toLocaleString("es-DO");
    const extra = h.ssl_days_left !== null && h.ssl_days_left !== undefined ? ` · SSL ${h.ssl_days_left}d` : "";
    return `<span class="dot ${c}" title="${t} — ${h.status}${h.status_code ? " · HTTP " + h.status_code : ""}${h.response_ms ? " · " + h.response_ms + "ms" : ""}${extra}"></span>`;
  }).join("");
}

async function load() {
  const em = email();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) { alert("Escribe un email válido"); return; }
  localStorage.setItem("vigia_email", em);
  $("dash-card").classList.remove("hidden");
  $("premium-card").classList.remove("hidden");
  await Promise.all([loadSites(), loadPremium()]);
}

async function loadSites() {
  const em = savedEmail() || email();
  try {
    const d = await api(`/api/sites?owner=${encodeURIComponent(em)}`);
    $("plan-line").innerHTML = `Plan actual: <b>${d.plan.toUpperCase()}</b>${d.premiumUntil ? " · premium hasta " + new Date(d.premiumUntil).toLocaleDateString("es-DO") : ""} · ${d.sites.length}/${d.plan === "premium" ? d.limits.premium : d.limits.free} sitios`;
    $("count").textContent = `(${d.sites.length})`;
    const box = $("sites");
    if (!d.sites.length) { box.innerHTML = `<p class="muted">Aún no agregas sitios. Empieza con el tuyo 👇</p>`; return; }
    box.innerHTML = d.sites.map((s) => {
      const last = s.history && s.history.length ? s.history[s.history.length - 1] : null;
      const ssl = last && last.ssl_days_left !== null && last.ssl_days_left !== undefined
        ? `<span class="ssl">🔒 SSL: ${last.ssl_days_left} días</span>` : "";
      const when = s.last_checked_at ? `<span class="muted small">revisado ${new Date(s.last_checked_at).toLocaleString("es-DO")}</span>` : "";
      return `<div class="site">
        <div class="site-top">${pill(s.last_status)}
          <b>${s.label ? escapeHtml(s.label) + " · " : ""}</b>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a>
          ${ssl} ${when}
        </div>
        <div class="site-hist">${dots(s.history)}</div>
        <div class="site-actions">
          <button class="btn small" data-check="${s.id}">⚡ Chequear ahora</button>
          <button class="btn small danger" data-del="${s.id}">Eliminar</button>
        </div>
      </div>`;
    }).join("");
    box.querySelectorAll("[data-check]").forEach((b) => b.onclick = () => checkNow(b.dataset.check, b));
    box.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("¿Eliminar este sitio del monitoreo?")) return;
      await api(`/api/sites?owner=${encodeURIComponent(em)}&id=${b.dataset.del}`, { method: "DELETE" });
      loadSites();
    });
  } catch (e) { $("sites").innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`; }
}

async function checkNow(id, btn) {
  btn.disabled = true; btn.textContent = "⏳ revisando…";
  try {
    const d = await api("/api/checknow", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner_email: savedEmail() || email(), site_id: id }),
    });
    alert(`Resultado: ${d.check.status}` + (d.check.sslDaysLeft !== null ? ` · SSL ${d.check.sslDaysLeft} días` : "") + (d.check.responseMs ? ` · ${d.check.responseMs}ms` : ""));
    loadSites();
  } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = "⚡ Chequear ahora"; }
}

async function addSite() {
  const url = $("new-url").value.trim();
  if (!url) { alert("Escribe la URL"); return; }
  try {
    await api("/api/sites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_email: savedEmail() || email(),
        url, label: $("new-label").value.trim(),
        telegram_chat_id: $("new-tg").value.trim(),
      }),
    });
    $("new-url").value = ""; $("new-label").value = ""; $("new-tg").value = "";
    loadSites();
  } catch (e) { alert(e.message); }
}

async function loadPremium() {
  const em = savedEmail() || email();
  const d = await api(`/api/premium?owner=${encodeURIComponent(em)}`);
  $("p-price").textContent = d.priceUsd;
  const body = $("premium-body");
  if (d.plan === "premium") {
    body.innerHTML = `<p class="ok-line">✅ <b>Premium activo</b> hasta ${new Date(d.premiumUntil).toLocaleDateString("es-DO")}. Tienes 20 sitios y chequeo cada 5 minutos.</p>`;
    return;
  }
  if (!d.walletReady) {
    body.innerHTML = `<p class="muted">El cobro en crypto se está activando. Vuelve pronto — el plan gratis ya funciona al 100%.</p>`;
    return;
  }
  body.innerHTML = `
    <p>1️⃣ Envía <b>${d.priceUsd} USDT</b> (red Tron/TRC20) a:<br>
    <code class="wallet">${d.wallet}</code>
    <button class="btn small" id="btn-copy">Copiar</button></p>
    <p>2️⃣ Pega aquí el hash de la transacción:</p>
    <div class="row"><input id="tx-hash" placeholder="hash de 64 caracteres"><button class="btn primary" id="btn-verify">Verificar y activar</button></div>
    <p class="muted small" id="tx-msg"></p>
    <p class="muted small">Verificamos el pago directamente en la cadena (Tronscan). Sin intermediarios, sin cuentas, sin KYC.</p>`;
  $("btn-copy").onclick = () => { navigator.clipboard.writeText(d.wallet); $("btn-copy").textContent = "✓ Copiado"; };
  $("btn-verify").onclick = async () => {
    $("tx-msg").textContent = "Verificando en la cadena…";
    try {
      const r = await api("/api/premium", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_email: em, tx_hash: $("tx-hash").value.trim() }),
      });
      $("tx-msg").textContent = `✅ Premium activo hasta ${new Date(r.premiumUntil).toLocaleDateString("es-DO")}`;
      loadSites();
    } catch (e) { $("tx-msg").textContent = "❌ " + e.message; }
  };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

$("btn-load").onclick = load;
$("btn-refresh").onclick = loadSites;
$("btn-add").onclick = addSite;
window.addEventListener("DOMContentLoaded", async () => {
  const em = savedEmail();
  if (em) { $("email").value = em; load(); }
  try {
    const h = await api("/api/health");
    $("health").textContent = h.tables ? "· sistema operativo" : "· DB pendiente de inicializar";
  } catch { $("health").textContent = ""; }
});
