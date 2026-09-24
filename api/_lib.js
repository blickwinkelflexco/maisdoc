// Gemeinsame Helfer für die API (Dateien mit _ sind auf Vercel keine eigenen Endpunkte).
import pg from "pg";
import crypto from "node:crypto";

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
let pool = null;
let schemaReady = null;

export const dbReady = () => !!CONN;

export function db() {
  if (!CONN) {
    const e = new Error("Datenbank ist nicht eingerichtet (DATABASE_URL fehlt).");
    e.status = 503; e.code = "no_db"; throw e;
  }
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(CONN) || CONN.includes("host=/");
    pool = new pg.Pool({ connectionString: CONN, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export async function q(text, params) {
  await ensureSchema();
  return db().query(text, params);
}

// Tabellen legt die App beim ersten Aufruf selbst an – kein Migrationsschritt nötig.
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db().query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        pw_hash text NOT NULL,
        name text NOT NULL DEFAULT '',
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created timestamptz NOT NULL DEFAULT now(),
        expires timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lieferungen (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        geaendert timestamptz NOT NULL,
        geloescht timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS felder (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        geaendert timestamptz NOT NULL,
        geloescht timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS fotos (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id text NOT NULL,
        mime text NOT NULL,
        data bytea NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS login_fail (
        email text NOT NULL,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS lieferungen_upd ON lieferungen (user_id, updated_at);
      CREATE INDEX IF NOT EXISTS felder_upd ON felder (user_id, updated_at);
      CREATE INDEX IF NOT EXISTS login_fail_email ON login_fail (email, at);
    `).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/* ---------- Passwörter (scrypt) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export function checkPassword(pw, stored) {
  const [alg, s, k] = String(stored).split("$");
  if (alg !== "scrypt" || !s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, "base64"), 32, { N: 16384, r: 8, p: 1 });
  const ref = Buffer.from(k, "base64");
  return ref.length === key.length && crypto.timingSafeEqual(ref, key);
}

/* ---------- Sitzungen (Cookie, HttpOnly) ---------- */
const COOKIE = "md_sess";
const SESSION_DAYS = 180;
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await q("INSERT INTO sessions (token_hash, user_id, expires) VALUES ($1, $2, now() + make_interval(days => $3))", [sha(token), userId, SESSION_DAYS]);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}
export function clearCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
function readCookie(req) {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}
export async function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const r = await q(
    `SELECT u.id, u.email, u.name, u.settings FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires > now()`, [sha(token)]);
  return r.rows[0] || null;
}
export async function endSession(req) {
  const token = readCookie(req);
  if (token) await q("DELETE FROM sessions WHERE token_hash = $1", [sha(token)]);
}
export async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) { const e = new Error("Bitte anmelden."); e.status = 401; e.code = "not_logged_in"; throw e; }
  return u;
}

/* ---------- HTTP ---------- */
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
  if (raw === null) {
    raw = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > 4_000_000) { reject(Object.assign(new Error("Zu groß."), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Ungültige Anfrage."), { status: 400 }); }
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

// Schreibende Anfragen nur aus der App selbst (Schutz gegen fremde Formulare).
export function checkOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return;
  if (req.headers["x-maisdoc"] !== "1") throw Object.assign(new Error("Nicht erlaubt."), { status: 403 });
}

export function handle(fn) {
  return async (req, res) => {
    try {
      checkOrigin(req);
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && e.code !== "no_db") console.error(e);
      send(res, status, { error: status >= 500 && e.code !== "no_db" ? "Serverfehler. Bitte später erneut versuchen." : e.message, code: e.code || null });
    }
  };
}

export const normEmail = (s) => String(s || "").trim().toLowerCase();
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
