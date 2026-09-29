// Anonymer Nutzungszähler: nur Anzahl je Tag und Ereignis. Keine IP, kein Cookie, keine Kennung.
import { q, handle, send, readBody } from "./_lib.js";

const ARTEN = new Set(["start", "ocr", "ocr_voll", "fuhre"]);

export default handle(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Methode nicht erlaubt." });
  const { art } = await readBody(req);
  if (!ARTEN.has(art)) return send(res, 400, { error: "Unbekannt." });
  await q(`INSERT INTO maisdoc.zaehler (tag, art, n) VALUES ((now() AT TIME ZONE 'Europe/Vienna')::date, $1, 1)
           ON CONFLICT (tag, art) DO UPDATE SET n = maisdoc.zaehler.n + 1`, [art]);
  send(res, 200, { ok: true });
});
