// API-Test gegen einen laufenden Server (npm run dev). BASE=http://localhost:3000 npm test
const BASE = process.env.BASE || "http://localhost:3000";
let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
function client() {
  let cookie = "";
  return async (path, body, method) => {
    const r = await fetch(BASE + path, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", "X-MaisDoc": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, data: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}
const email = `test${Date.now()}@example.at`;

// Minimaler SMTP-Empfänger für den Test: sammelt jede Mail (Umschlag + Inhalt) als Text.
async function smtpSink(port) {
  const net = await import("node:net");
  const mails = [];
  const srv = net.createServer((c) => {
    let buf = "", data = false, cur = "";
    c.write("220 test\r\n");
    c.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === ".") { data = false; mails.push(cur.replace(/=\n/g, "").replace(/=3D/g, "=")); cur = ""; c.write("250 ok\r\n"); } else cur += line + "\n"; continue; }
        cur += line + "\n";
        if (/^EHLO/i.test(line)) c.write("250-test\r\n250 8BITMIME\r\n");
        else if (/^DATA/i.test(line)) { data = true; c.write("354 go\r\n"); }
        else if (/^QUIT/i.test(line)) { c.write("221 bye\r\n"); c.end(); }
        else c.write("250 ok\r\n");
      }
    });
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  mails.close = () => srv.close();
  return mails;
}
const A = client(), B = client(), X = client();

let r = await A("/api/auth");                                   ok(r.data.user === null, "ohne Anmeldung kein Benutzer");
r = await A("/api/auth?action=register", { email, password: "kurz" }); ok(r.status === 400, "zu kurzes Passwort abgelehnt");
r = await A("/api/auth?action=register", { email, password: "maisfeld2026", name: "Test", settings: { kundeNr: "10410" } }); ok(r.status === 201 && r.data.user.email === email, "Konto angelegt");
r = await A("/api/auth?action=register", { email, password: "maisfeld2026" }); ok(r.status === 409, "doppeltes Konto abgelehnt");
r = await A("/api/auth");                                       ok(r.data.user?.settings?.kundeNr === "10410", "Sitzung und Einstellungen da");

const now = new Date().toISOString();
const lief = { id: "L1", datum: "2026-09-24", jahr: 2026, waNr: "100120", w1: 43820, w2: 15840, netto: 27980, feuchte: 24.7, abzug: 0.6, feldId: "F1", ha: 1.8, geaendert: now, hatFoto: true, foto: "BLOB", dirty: true };
r = await A("/api/sync", { since: null, lieferungen: [lief], felder: [{ id: "F1", name: "Pirath Süd", geaendert: now }] });
ok(r.status === 200 && r.data.lieferungen.length === 1 && r.data.lieferungen[0].foto === undefined && r.data.lieferungen[0].dirty === undefined, "Fuhre hochgeladen, Blob/Merker nicht gespeichert");
const since1 = r.data.serverTime;

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
r = await A("/api/foto?id=L1", { mime: "image/jpeg", data: jpg.toString("base64") }); ok(r.status === 200, "Foto hochgeladen");
r = await A("/api/foto?id=L1");                                 ok(Buffer.compare(r.data, jpg) === 0, "Foto zurückgelesen");
r = await A("/api/foto?id=NIX", { mime: "image/jpeg", data: jpg.toString("base64") }); ok(r.status === 404, "Foto ohne Fuhre abgelehnt");

// zweites Gerät
r = await B("/api/auth?action=login", { email, password: "falsch123" }); ok(r.status === 401, "falsches Passwort abgelehnt");
r = await B("/api/auth?action=login", { email: email.toUpperCase(), password: "maisfeld2026" }); ok(r.status === 200, "Anmeldung auf Gerät B (E-Mail unabhängig von Groß/klein)");
r = await B("/api/sync", { since: null });                      ok(r.data.lieferungen[0]?.ha === 1.8 && r.data.felder[0]?.name === "Pirath Süd" && r.data.fotos.includes("L1"), "Gerät B bekommt Fuhre, Feld, Foto-Liste");
const sinceB = r.data.serverTime;

// Konflikt: älterer Stand verliert
r = await B("/api/sync", { since: sinceB, lieferungen: [{ ...lief, ha: 9, geaendert: "2026-01-01T00:00:00Z" }] });
r = await A("/api/sync", { since: null });                      ok(r.data.lieferungen[0].ha === 1.8, "älterer Stand überschreibt nicht");
// neuerer Stand gewinnt
const later = new Date(Date.now() + 1000).toISOString();
await B("/api/sync", { since: sinceB, lieferungen: [{ ...lief, ha: 2.1, geaendert: later }] });
r = await A("/api/sync", { since: since1 });                    ok(r.data.lieferungen.some((x) => x.id === "L1" && x.ha === 2.1), "neuerer Stand kommt per Delta auf Gerät A");

// fremder Zugriff
r = await X("/api/sync", { since: null });                      ok(r.status === 401, "ohne Anmeldung kein Abgleich");
r = await X("/api/foto?id=L1");                                 ok(r.status === 401, "ohne Anmeldung kein Foto");
const other = `other${Date.now()}@example.at`;
await X("/api/auth?action=register", { email: other, password: "anderes-passwort" });
r = await X("/api/sync", { since: null });                      ok(r.data.lieferungen.length === 0, "anderes Konto sieht nichts");
r = await X("/api/foto?id=L1");                                 ok(r.status === 404, "anderes Konto bekommt fremdes Foto nicht");

// ohne Kopfzeile kein Schreiben (CSRF)
const raw = await fetch(BASE + "/api/auth?action=logout", { method: "POST" }); ok(raw.status === 403, "Schreiben ohne App-Kopfzeile abgelehnt");

// Löschen per Grabstein
const del = new Date(Date.now() + 2000).toISOString();
await A("/api/sync", { lieferungen: [{ ...lief, ha: 2.1, geaendert: del, geloescht: del }] });
r = await B("/api/sync", { since: sinceB });                    ok(r.data.lieferungen.some((x) => x.id === "L1" && x.geloescht), "Löschung kommt auf Gerät B an");
r = await A("/api/foto?id=L1");                                 ok(r.status === 404, "Foto mit Fuhre gelöscht");

// Passwort ändern, abmelden, Konto löschen
r = await A("/api/auth?action=password", { old: "maisfeld2026", password: "neuesPasswort1" }); ok(r.status === 200, "Passwort geändert");
r = await A("/api/auth?action=logout", {});                     ok(r.status === 200, "abgemeldet");
r = await A("/api/auth");                                       ok(r.data.user === null, "Sitzung beendet");
r = await A("/api/auth?action=login", { email, password: "neuesPasswort1" }); ok(r.status === 200, "Anmeldung mit neuem Passwort");

// Passwort vergessen. Voller Durchlauf nur mit SMTP_TEST_PORT (Server mit SMTP_HOST=127.0.0.1 und diesem Port starten).
r = await X("/api/auth");
if (!r.data.mail) {
  r = await X("/api/auth?action=reset-request", { email });   ok(r.status === 503 && r.data.code === "no_mail", "ohne Mailversand: Rücksetzen meldet no_mail");
} else if (process.env.SMTP_TEST_PORT) {
  const mails = await smtpSink(Number(process.env.SMTP_TEST_PORT));
  r = await X("/api/auth?action=reset-request", { email: "gibtsnicht@example.at" }); ok(r.status === 200 && mails.length === 0, "unbekannte E-Mail: gleiche Antwort, keine Mail");
  r = await X("/api/auth?action=reset-request", { email: email.toUpperCase() }); ok(r.status === 200 && mails.length === 1, "Rücksetz-Mail verschickt");
  const token = (mails[0].match(/#reset=([A-Za-z0-9_-]+)/) || [])[1];
  ok(!!token && mails[0].includes(`RCPT TO:<${email}>`), "Mail geht an die Konto-Adresse und enthält den Link");
  r = await X("/api/auth?action=reset", { token, password: "kurz" });            ok(r.status === 400, "zu kurzes neues Passwort abgelehnt");
  r = await X("/api/auth?action=reset", { token: "falsch-falsch-falsch-falsch", password: "zurueckgesetzt1" }); ok(r.status === 400 && r.data.code === "bad_token", "falscher Link abgelehnt");
  r = await X("/api/auth?action=reset", { token, password: "zurueckgesetzt1" }); ok(r.status === 200 && r.data.user.email === email, "Passwort per Link gesetzt, angemeldet");
  r = await X("/api/sync", { since: null });                                     ok(r.status === 200, "neue Sitzung gilt");
  r = await A("/api/sync", { since: null });                                     ok(r.status === 401, "alte Sitzungen abgemeldet");
  r = await X("/api/auth?action=reset", { token, password: "nochmal12345" });    ok(r.status === 400, "Link nur einmal gültig");
  r = await A("/api/auth?action=login", { email, password: "zurueckgesetzt1" }); ok(r.status === 200, "Anmeldung mit neuem Passwort");
  await X("/api/auth?action=reset-request", { email }); await X("/api/auth?action=reset-request", { email });
  r = await X("/api/auth?action=reset-request", { email });                      ok(r.status === 429, "höchstens 3 Links je Stunde");
  await A("/api/auth?action=password", { old: "zurueckgesetzt1", password: "neuesPasswort1" });
  mails.close();
} else console.log("--   Rücksetzen per Mail nicht geprüft (SMTP_TEST_PORT fehlt)");
r = await A("/api/auth?action=delete", { password: "neuesPasswort1" }); ok(r.status === 200, "Konto gelöscht");
r = await B("/api/sync", { since: null });                      ok(r.status === 401, "Sitzungen des gelöschten Kontos ungültig");
await X("/api/auth?action=delete", { password: "anderes-passwort" });

// Zähler und Statistik
r = await X("/api/zaehler", { art: "start" });                  ok(r.status === 200, "Zähler zählt");
r = await X("/api/zaehler", { art: "irgendwas" });              ok(r.status === 400, "Zähler nimmt nur bekannte Ereignisse");
r = await X("/api/stats");                                      ok(r.status === 404, "Statistik ohne Schlüssel gesperrt");
if (process.env.STATS_TOKEN) {
  const res = await fetch(BASE + "/api/stats", { headers: { Authorization: "Bearer " + process.env.STATS_TOKEN } });
  const st = await res.json();
  ok(res.status === 200 && st.zaehler.summe.start >= 1 && typeof st.konten.gesamt === "number" && !JSON.stringify(st).includes("@"), "Statistik mit Schlüssel: Summen, keine E-Mail-Adressen");
  const bad = await fetch(BASE + "/api/stats", { headers: { Authorization: "Bearer falsch" } });
  ok(bad.status === 404, "falscher Schlüssel abgelehnt");
}

// Sperre nach Fehlversuchen
for (let i = 0; i < 8; i++) await X("/api/auth?action=login", { email: "sperre@example.at", password: "xxxxxxxx" });
r = await X("/api/auth?action=login", { email: "sperre@example.at", password: "xxxxxxxx" }); ok(r.status === 429, "Sperre nach 8 Fehlversuchen");

console.log(fails ? `\n${fails} Fehler` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
