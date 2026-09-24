// Foto eines Wiegescheins: hochladen (POST, JSON mit Base64) und abrufen (GET, nur eigene).
import { q, handle, send, readBody, requireUser } from "./_lib.js";

const MAX_BYTES = 2_500_000;

export default handle(async (req, res) => {
  const u = await requireUser(req);
  const id = String(new URL(req.url, "http://x").searchParams.get("id") || "").slice(0, 80);
  if (!id) return send(res, 400, { error: "id fehlt." });

  if (req.method === "GET") {
    const r = await q("SELECT mime, data FROM fotos WHERE user_id = $1 AND id = $2", [u.id, id]);
    if (!r.rows[0]) return send(res, 404, { error: "Kein Foto." });
    res.statusCode = 200;
    res.setHeader("Content-Type", r.rows[0].mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.end(r.rows[0].data);
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const mime = /^image\/(jpeg|png|webp)$/.test(body.mime) ? body.mime : "image/jpeg";
    const buf = Buffer.from(String(body.data || ""), "base64");
    if (!buf.length) return send(res, 400, { error: "Foto fehlt." });
    if (buf.length > MAX_BYTES) return send(res, 413, { error: "Foto ist zu groß." });
    const own = await q("SELECT 1 FROM lieferungen WHERE user_id = $1 AND id = $2 AND geloescht IS NULL", [u.id, id]);
    if (!own.rows[0]) return send(res, 404, { error: "Fuhre nicht gefunden. Erst abgleichen, dann Foto senden." });
    await q(
      `INSERT INTO fotos (user_id, id, mime, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
      [u.id, id, mime, buf]);
    return send(res, 200, { ok: true });
  }

  if (req.method === "DELETE") {
    await q("DELETE FROM fotos WHERE user_id = $1 AND id = $2", [u.id, id]);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: "Methode nicht erlaubt." });
});
