// Motor de monitoreo: HTTP status + tiempo de respuesta + días restantes del certificado SSL.
// El certificado se lee del MISMO socket HTTPS del probe (res.socket.getPeerCertificate()),
// así funciona directo y también detrás de proxies de salida.
const http = require("http");
const https = require("https");

const TIMEOUT_MS = 12000;
const HARD_CAP_MS = 25000;
const MAX_REDIRECTS = 3;

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    let done = false;
    const finish = (fn) => (arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };
    const ok = finish(resolve), bad = finish(reject);
    const timer = setTimeout(() => { try { req.destroy(); } catch {} bad(new Error("timeout")); }, TIMEOUT_MS);
    let req;
    try {
      req = mod.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: (u.pathname + u.search) || "/",
          method: "GET",
          headers: { "User-Agent": "VigiaWeb/1.0 (+monitoreo uptime)" },
          rejectUnauthorized: false, // el estado del cert lo evaluamos nosotros, no el handshake
          timeout: TIMEOUT_MS,
        },
        (res) => {
          let cert = null;
          try {
            if (u.protocol === "https:" && res.socket && res.socket.getPeerCertificate) {
              cert = res.socket.getPeerCertificate();
            }
          } catch {}
          res.resume();
          ok({ status: res.statusCode, headers: res.headers, cert });
        }
      );
    } catch (e) { bad(e); return; }
    req.on("timeout", () => { try { req.destroy(); } catch {} bad(new Error("timeout")); });
    req.on("error", (e) => bad(e));
    req.end();
  });
}

async function fetchWithRedirects(url) {
  let current = url;
  let last = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await fetchOnce(current);
    last = r;
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      current = new URL(r.headers.location, current).toString();
      continue;
    }
    return r;
  }
  return last || { status: 310, headers: {}, cert: null };
}

function sslDaysLeft(cert) {
  if (!cert || !cert.valid_to) return null;
  return Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
}

// Clasificación:
// - DOWN: error de red/timeout/DNS, o HTTP >= 500
// - SSL_SOON: responde pero el cert vence en <= 14 días (o ya venció)
// - OK: todo lo demás
async function checkSite(rawUrl) {
  const started = Date.now();
  let url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const u = new URL(url);
  const result = {
    url: u.toString(), ok: false, status: "DOWN",
    statusCode: null, responseMs: null, sslDaysLeft: null, error: null,
  };
  const run = (async () => {
    try {
      const r = await fetchWithRedirects(u.toString());
      result.statusCode = r.status;
      result.responseMs = Date.now() - started;
      if (u.protocol === "https:") result.sslDaysLeft = sslDaysLeft(r.cert);
      if (r.status >= 500) {
        result.error = `HTTP ${r.status}`;
      } else if (result.sslDaysLeft !== null && result.sslDaysLeft <= 14) {
        result.ok = true;
        result.status = "SSL_SOON";
      } else {
        result.ok = true;
        result.status = "OK";
      }
    } catch (e) {
      result.responseMs = Date.now() - started;
      result.error = String(e.message || e).slice(0, 200);
      result.status = "DOWN";
    }
    return result;
  })();
  const cap = new Promise((resolve) =>
    setTimeout(() => {
      if (result.statusCode === null && !result.error) result.error = "timeout (límite duro)";
      result.responseMs = result.responseMs ?? Date.now() - started;
      resolve(result);
    }, HARD_CAP_MS)
  );
  return Promise.race([run, cap]);
}

module.exports = { checkSite };
