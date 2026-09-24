// Konto: registrieren, anmelden, abmelden, Passwort ändern, Konto löschen.
import { q, dbReady, handle, send, readBody, currentUser, requireUser, createSession, endSession, clearCookie,
  hashPassword, checkPassword, normEmail, isEmail } from "./_lib.js";

const MAX_FAILS = 8;          // Fehlversuche je E-Mail …
const FAIL_WINDOW_MIN = 15;   // … in diesem Zeitfenster

const pub = (u) => ({ id: u.id, email: u.email, name: u.name || "", settings: u.settings || {} });

export default handle(async (req, res) => {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "";

  if (req.method === "GET") {
    if (!dbReady()) return send(res, 200, { user: null, ready: false });
    const u = await currentUser(req);
    return send(res, 200, { user: u ? pub(u) : null, ready: true });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Methode nicht erlaubt." });
  const body = await readBody(req);

  if (action === "register") {
    const email = normEmail(body.email);
    const pw = String(body.password || "");
    const name = String(body.name || "").trim().slice(0, 120);
    if (!isEmail(email)) return send(res, 400, { error: "Bitte eine gültige E-Mail-Adresse eingeben." });
    if (pw.length < 8) return send(res, 400, { error: "Das Passwort braucht mindestens 8 Zeichen." });
    const settings = body.settings && typeof body.settings === "object" ? body.settings : {};
    const r = await q(
      `INSERT INTO users (email, pw_hash, name, settings) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, name, settings`,
      [email, hashPassword(pw), name, JSON.stringify(settings)]);
    if (!r.rows[0]) return send(res, 409, { error: "Für diese E-Mail gibt es schon ein Konto. Bitte anmelden." });
    await createSession(res, r.rows[0].id);
    return send(res, 201, { user: pub(r.rows[0]) });
  }

  if (action === "login") {
    const email = normEmail(body.email);
    const pw = String(body.password || "");
    const f = await q(`SELECT count(*)::int AS n FROM login_fail WHERE email = $1 AND at > now() - make_interval(mins => $2)`, [email, FAIL_WINDOW_MIN]);
    if (f.rows[0].n >= MAX_FAILS) return send(res, 429, { error: `Zu viele Fehlversuche. Bitte in ${FAIL_WINDOW_MIN} Minuten erneut versuchen.` });
    const r = await q("SELECT id, email, name, settings, pw_hash FROM users WHERE email = $1", [email]);
    const u = r.rows[0];
    if (!u || !checkPassword(pw, u.pw_hash)) {
      await q("INSERT INTO login_fail (email) VALUES ($1)", [email]);
      await q("DELETE FROM login_fail WHERE at < now() - interval '1 day'");
      return send(res, 401, { error: "E-Mail oder Passwort stimmt nicht." });
    }
    await q("DELETE FROM login_fail WHERE email = $1", [email]);
    await q("DELETE FROM sessions WHERE user_id = $1 AND expires < now()", [u.id]);
    await createSession(res, u.id);
    return send(res, 200, { user: pub(u) });
  }

  if (action === "logout") {
    await endSession(req);
    clearCookie(res);
    return send(res, 200, { ok: true });
  }

  if (action === "password") {
    const u = await requireUser(req);
    const r = await q("SELECT pw_hash FROM users WHERE id = $1", [u.id]);
    if (!checkPassword(String(body.old || ""), r.rows[0].pw_hash)) return send(res, 401, { error: "Das bisherige Passwort stimmt nicht." });
    const pw = String(body.password || "");
    if (pw.length < 8) return send(res, 400, { error: "Das neue Passwort braucht mindestens 8 Zeichen." });
    await q("UPDATE users SET pw_hash = $2 WHERE id = $1", [u.id, hashPassword(pw)]);
    return send(res, 200, { ok: true });
  }

  if (action === "delete") {
    const u = await requireUser(req);
    const r = await q("SELECT pw_hash FROM users WHERE id = $1", [u.id]);
    if (!checkPassword(String(body.password || ""), r.rows[0].pw_hash)) return send(res, 401, { error: "Das Passwort stimmt nicht." });
    await q("DELETE FROM users WHERE id = $1", [u.id]); // löscht Sitzungen, Fuhren, Felder, Fotos mit
    clearCookie(res);
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { error: "Unbekannte Aktion." });
});
