// Nutzungsstatistik für BLICKWINKEL. Nur Summen, keine E-Mail-Adressen oder Inhalte.
// Zugang mit STATS_TOKEN (Vercel → Environment Variables): Kopfzeile „Authorization: Bearer <Token>“.
import crypto from "node:crypto";
import { q, handle, send } from "./_lib.js";

const TOKEN = process.env.STATS_TOKEN || "";
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default handle(async (req, res) => {
  if (req.method !== "GET") return send(res, 405, { error: "Methode nicht erlaubt." });
  const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!TOKEN || !auth || !same(auth, TOKEN)) return send(res, 404, { error: "Nicht gefunden." });

  const one = async (sql) => (await q(sql)).rows[0];
  const konten = await one(`SELECT count(*)::int AS gesamt,
      count(*) FILTER (WHERE zuletzt > now() - interval '7 days')::int AS aktiv7,
      count(*) FILTER (WHERE zuletzt > now() - interval '30 days')::int AS aktiv30,
      min(created) AS erstes, max(created) AS neuestes FROM maisdoc.users`);
  const fuhren = await one(`SELECT count(*)::int AS gesamt, count(DISTINCT user_id)::int AS konten,
      max(geaendert) AS zuletzt FROM maisdoc.lieferungen WHERE geloescht IS NULL`);
  const felder = await one(`SELECT count(*)::int AS gesamt FROM maisdoc.felder WHERE geloescht IS NULL`);
  const fotos = await one(`SELECT count(*)::int AS gesamt, coalesce(sum(length(data)), 0)::bigint AS bytes FROM maisdoc.fotos`);
  const tage = (await q(`SELECT tag::text, art, n FROM maisdoc.zaehler WHERE tag > current_date - 60 ORDER BY tag DESC`)).rows;
  const summe = (await q(`SELECT art, sum(n)::int AS n FROM maisdoc.zaehler GROUP BY art`)).rows;
  const neu = (await q(`SELECT (created AT TIME ZONE 'Europe/Vienna')::date::text AS tag, count(*)::int AS n
      FROM maisdoc.users WHERE created > now() - interval '60 days' GROUP BY 1 ORDER BY 1 DESC`)).rows;
  send(res, 200, { stand: new Date().toISOString(), konten, fuhren, felder, fotos: { gesamt: fotos.gesamt, mb: Math.round(Number(fotos.bytes) / 1e5) / 10 },
    zaehler: { summe: Object.fromEntries(summe.map((r) => [r.art, r.n])), tage }, neueKonten: neu });
});
