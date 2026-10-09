// Helper mínimo para Supabase PostgREST (solo server-side, usa service_role).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function configured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

async function req(method, path, body) {
  if (!configured()) throw new Error("Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY)");
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.hint)) || text || `HTTP ${res.status}`;
    const err = new Error(`Supabase ${res.status}: ${msg}`);
    err.status = res.status;
    err.missingTable = res.status === 404 || /relation .* does not exist|Could not find the table/i.test(msg);
    throw err;
  }
  return data;
}

const get = (path) => req("GET", path);
const post = (path, body) => req("POST", path, body);
const patch = (path, body) => req("PATCH", path, body);
const del = (path) => req("DELETE", path);

module.exports = { configured, get, post, patch, del };
