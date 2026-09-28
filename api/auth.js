// Konto: registrieren, anmelden, abmelden, Passwort ändern, Passwort vergessen, Konto löschen.
import crypto from "node:crypto";
import { q, dbReady, handle, send, readBody, currentUser, requireUser, createSession, endSession, clearCookie,
  hashPassword, checkPassword, normEmail, isEmail, sha } from "./_lib.js";
import { mailReady, sendMail, APP_URL } from "./_mail.js";

const MAX_FAILS = 8;          // Fehlversuche je E-Mail …
const FAIL_WINDOW_MIN = 15;   // … in diesem Zeitfenster
const RESET_MIN = 60;         // Rücksetz-Link gilt so lange …
const RESET_MAX = 3;          // … und höchstens so viele Links je Konto und Stunde

const pub = (u) => ({ id: u.id, email: u.email, name: u.name || "", settings: u.settings || {} });

export default handle(async (req, res) => {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "";

  if (req.method === "GET") {
    if (!dbReady()) return send(res, 200, { user: null, ready: false });
    const u = await currentUser(req);
    return send(res, 200, { user: u ? pub(u) : null, ready: true, mail: mailReady() });
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
      `INSERT INTO maisdoc.users (email, pw_hash, name, settings) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, name, settings`,
      [email, hashPassword(pw), name, JSON.stringify(settings)]);
    if (!r.rows[0]) return send(res, 409, { error: "Für diese E-Mail gibt es schon ein Konto. Bitte anmelden." });
    await createSession(res, r.rows[0].id);
    return send(res, 201, { user: pub(r.rows[0]) });
  }

  if (action === "login") {
    const email = normEmail(body.email);
    const pw = String(body.password || "");
    const f = await q(`SELECT count(*)::int AS n FROM maisdoc.login_fail WHERE email = $1 AND at > now() - make_interval(mins => $2)`, [email, FAIL_WINDOW_MIN]);
    if (f.rows[0].n >= MAX_FAILS) return send(res, 429, { error: `Zu viele Fehlversuche. Bitte in ${FAIL_WINDOW_MIN} Minuten erneut versuchen.` });
    const r = await q("SELECT id, email, name, settings, pw_hash FROM maisdoc.users WHERE email = $1", [email]);
    const u = r.rows[0];
    if (!u || !checkPassword(pw, u.pw_hash)) {
      await q("INSERT INTO maisdoc.login_fail (email) VALUES ($1)", [email]);
      await q("DELETE FROM maisdoc.login_fail WHERE at < now() - interval '1 day'");
      return send(res, 401, { error: "E-Mail oder Passwort stimmt nicht." });
    }
    await q("DELETE FROM maisdoc.login_fail WHERE email = $1", [email]);
    await q("DELETE FROM maisdoc.sessions WHERE user_id = $1 AND expires < now()", [u.id]);
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
    const r = await q("SELECT pw_hash FROM maisdoc.users WHERE id = $1", [u.id]);
    if (!checkPassword(String(body.old || ""), r.rows[0].pw_hash)) return send(res, 401, { error: "Das bisherige Passwort stimmt nicht." });
    const pw = String(body.password || "");
    if (pw.length < 8) return send(res, 400, { error: "Das neue Passwort braucht mindestens 8 Zeichen." });
    await q("UPDATE maisdoc.users SET pw_hash = $2 WHERE id = $1", [u.id, hashPassword(pw)]);
    return send(res, 200, { ok: true });
  }

  // Passwort vergessen: Link per E-Mail. Antwort immer gleich, ob es das Konto gibt oder nicht.
  if (action === "reset-request") {
    if (!mailReady()) return send(res, 503, { error: "Passwort-Rücksetzen per E-Mail ist noch nicht eingerichtet.", code: "no_mail" });
    const email = normEmail(body.email);
    if (!isEmail(email)) return send(res, 400, { error: "Bitte eine gültige E-Mail-Adresse eingeben." });
    const r = await q("SELECT id FROM maisdoc.users WHERE email = $1", [email]);
    const u = r.rows[0];
    if (u) {
      await q("DELETE FROM maisdoc.pw_reset WHERE created < now() - interval '1 day'");
      const n = await q("SELECT count(*)::int AS n FROM maisdoc.pw_reset WHERE user_id = $1 AND created > now() - interval '1 hour'", [u.id]);
      if (n.rows[0].n >= RESET_MAX) return send(res, 429, { error: "Es wurden schon mehrere Links geschickt. Bitte ins Postfach (auch Spam) schauen oder in einer Stunde erneut versuchen." });
      const token = crypto.randomBytes(32).toString("base64url");
      await q("INSERT INTO maisdoc.pw_reset (token_hash, user_id, expires) VALUES ($1, $2, now() + make_interval(mins => $3))", [sha(token), u.id, RESET_MIN]);
      const link = `${APP_URL}/#reset=${token}`;
      try {
        await sendMail({
          to: email,
          subject: "MaisDoc: Passwort zurücksetzen",
          text: `Servus,\n\nüber diesen Link setzt du ein neues Passwort für MaisDoc:\n\n${link}\n\nDer Link gilt ${RESET_MIN} Minuten und funktioniert einmal. Wenn du das nicht angefordert hast, ignoriere diese E-Mail, dein Passwort bleibt dann gleich.\n\nMaisDoc · BLICKWINKEL FlexCo · info@blickwinkel.pro\n`,
          html: `<p>Servus,</p><p>über diesen Link setzt du ein neues Passwort für MaisDoc:</p><p><a href="${link}">Neues Passwort setzen</a></p><p>Der Link gilt ${RESET_MIN} Minuten und funktioniert einmal. Wenn du das nicht angefordert hast, ignoriere diese E-Mail, dein Passwort bleibt dann gleich.</p><p style="color:#777">MaisDoc · BLICKWINKEL FlexCo · info@blickwinkel.pro</p>`,
        });
      } catch (e) {
        await q("DELETE FROM maisdoc.pw_reset WHERE token_hash = $1", [sha(token)]);
        console.error(e);
        return send(res, 502, { error: "Die E-Mail konnte gerade nicht gesendet werden. Bitte später erneut versuchen." });
      }
    }
    return send(res, 200, { ok: true });
  }

  if (action === "reset") {
    const token = String(body.token || "");
    const pw = String(body.password || "");
    if (pw.length < 8) return send(res, 400, { error: "Das neue Passwort braucht mindestens 8 Zeichen." });
    // Einmal-Link: beim Einlösen entwertet (Zeile bleibt für die Höchstzahl je Stunde)
    const t = token ? await q("UPDATE maisdoc.pw_reset SET expires = '-infinity' WHERE token_hash = $1 AND expires > now() RETURNING user_id", [sha(token)]) : { rows: [] };
    if (!t.rows[0]) return send(res, 400, { error: "Der Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.", code: "bad_token" });
    const r = await q("UPDATE maisdoc.users SET pw_hash = $2 WHERE id = $1 RETURNING id, email, name, settings", [t.rows[0].user_id, hashPassword(pw)]);
    const u = r.rows[0];
    await q("UPDATE maisdoc.pw_reset SET expires = '-infinity' WHERE user_id = $1", [u.id]);   // andere offene Links auch
    await q("DELETE FROM maisdoc.sessions WHERE user_id = $1", [u.id]);   // alle Geräte abmelden
    await q("DELETE FROM maisdoc.login_fail WHERE email = $1", [u.email]);
    await createSession(res, u.id);
    return send(res, 200, { user: pub(u) });
  }

  if (action === "delete") {
    const u = await requireUser(req);
    const r = await q("SELECT pw_hash FROM maisdoc.users WHERE id = $1", [u.id]);
    if (!checkPassword(String(body.password || ""), r.rows[0].pw_hash)) return send(res, 401, { error: "Das Passwort stimmt nicht." });
    await q("DELETE FROM maisdoc.users WHERE id = $1", [u.id]); // löscht Sitzungen, Fuhren, Felder, Fotos mit
    clearCookie(res);
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { error: "Unbekannte Aktion." });
});
