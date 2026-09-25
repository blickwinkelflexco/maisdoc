// Abgleich Gerät ↔ Konto. Das Gerät schickt geänderte Fuhren/Felder, der Server
// antwortet mit allem, was sich seit dem letzten Abgleich geändert hat.
// Konfliktregel: der jüngere Stand ("geaendert") gewinnt. Löschen = Grabstein ("geloescht").
import { q, handle, send, readBody, requireUser } from "./_lib.js";

const MAX_ITEMS = 2000;
const TABLES = { lieferungen: "maisdoc.lieferungen", felder: "maisdoc.felder" };

function clean(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").slice(0, 80);
  const ge = Date.parse(item.geaendert);
  if (!id || !isFinite(ge)) return null;
  const { foto, dirty, fotoDirty, ...data } = item; // Blobs und lokale Merker bleiben am Gerät
  data.id = id;
  const del = item.geloescht && isFinite(Date.parse(item.geloescht)) ? new Date(item.geloescht).toISOString() : null;
  return { id, data, geaendert: new Date(ge).toISOString(), geloescht: del };
}

async function upsert(table, userId, items) {
  for (const it of items) {
    await q(
      `INSERT INTO ${table} (user_id, id, data, geaendert, geloescht, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, id) DO UPDATE
         SET data = EXCLUDED.data, geaendert = EXCLUDED.geaendert, geloescht = EXCLUDED.geloescht, updated_at = now()
         WHERE ${table}.geaendert < EXCLUDED.geaendert`,
      [userId, it.id, JSON.stringify(it.data), it.geaendert, it.geloescht]);
    if (table === TABLES.lieferungen && it.geloescht) await q("DELETE FROM maisdoc.fotos WHERE user_id = $1 AND id = $2", [userId, it.id]);
  }
}

export default handle(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Methode nicht erlaubt." });
  const u = await requireUser(req);
  const body = await readBody(req);
  const t0 = (await q("SELECT now() AS t")).rows[0].t;

  for (const key of Object.keys(TABLES)) {
    const items = (Array.isArray(body[key]) ? body[key] : []).slice(0, MAX_ITEMS).map(clean).filter(Boolean);
    await upsert(TABLES[key], u.id, items);
  }

  let settings = u.settings || {};
  if (body.settings && typeof body.settings === "object") {
    const inc = body.settings;
    if (!settings.geaendert || (inc.geaendert && Date.parse(inc.geaendert) > Date.parse(settings.geaendert))) {
      settings = { kundeNr: String(inc.kundeNr || "").slice(0, 40), trocknung: String(inc.trocknung || "").slice(0, 120), stdFeuchte: Number(inc.stdFeuchte) || 14,
        abzugAnwenden: inc.abzugAnwenden !== false, geaendert: inc.geaendert || new Date().toISOString() };
      await q("UPDATE maisdoc.users SET settings = $2 WHERE id = $1", [u.id, JSON.stringify(settings)]);
    }
  }

  const since = body.since && isFinite(Date.parse(body.since)) ? new Date(body.since).toISOString() : "epoch";
  const out = {};
  for (const key of Object.keys(TABLES)) {
    const r = await q(`SELECT data, geaendert, geloescht FROM ${TABLES[key]} WHERE user_id = $1 AND updated_at >= $2::timestamptz ORDER BY updated_at`, [u.id, since]);
    out[key] = r.rows.map((x) => ({ ...x.data, geaendert: x.geaendert.toISOString(), geloescht: x.geloescht ? x.geloescht.toISOString() : null }));
  }
  const fotos = await q("SELECT id FROM maisdoc.fotos WHERE user_id = $1", [u.id]);
  // 5 s Sicherheitsabstand für gleichzeitig laufende Schreibvorgänge anderer Geräte
  send(res, 200, { serverTime: new Date(new Date(t0).getTime() - 5000).toISOString(), settings, fotos: fotos.rows.map((r) => r.id), ...out });
});
