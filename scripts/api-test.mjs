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
r = await A("/api/auth?action=delete", { password: "neuesPasswort1" }); ok(r.status === 200, "Konto gelöscht");
r = await B("/api/sync", { since: null });                      ok(r.status === 401, "Sitzungen des gelöschten Kontos ungültig");
await X("/api/auth?action=delete", { password: "anderes-passwort" });

// Sperre nach Fehlversuchen
for (let i = 0; i < 8; i++) await X("/api/auth?action=login", { email: "sperre@example.at", password: "xxxxxxxx" });
r = await X("/api/auth?action=login", { email: "sperre@example.at", password: "xxxxxxxx" }); ok(r.status === 429, "Sperre nach 8 Fehlversuchen");

console.log(fails ? `\n${fails} Fehler` : "\nAlle Tests bestanden");
process.exit(fails ? 1 : 0);
