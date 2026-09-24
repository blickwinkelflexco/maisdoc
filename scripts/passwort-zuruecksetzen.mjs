// Passwort eines Mitglieds zurücksetzen (für BLICKWINKEL, wenn jemand sein Passwort vergessen hat).
// Aufruf: DATABASE_URL=… node scripts/passwort-zuruecksetzen.mjs mitglied@example.at
// Gibt ein neues Einmal-Passwort aus und meldet alle Geräte ab. Das Mitglied ändert es danach unter „Konto“.
import crypto from "node:crypto";
import { q, hashPassword, db } from "../api/_lib.js";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) { console.error("E-Mail fehlt."); process.exit(1); }
const pw = crypto.randomBytes(9).toString("base64url");
const r = await q("UPDATE users SET pw_hash = $2 WHERE email = $1 RETURNING id", [email, hashPassword(pw)]);
if (!r.rows[0]) { console.error("Kein Konto mit dieser E-Mail."); process.exit(1); }
await q("DELETE FROM sessions WHERE user_id = $1", [r.rows[0].id]);
console.log(`Neues Passwort für ${email}: ${pw}`);
await db().end();
