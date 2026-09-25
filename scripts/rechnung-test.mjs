// Prüft die Rechnung der App (calc in index.html) gegen einen echten Kontoauszug
// der Trocknung (Mais Ernte 2025, 23 Fuhren, Umrechnungsfaktor 1,189, Abzug 0,6 %).
// Aufruf: node scripts/rechnung-test.mjs
import fs from "node:fs";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = html.match(/const DEF_FAKTOR[\s\S]*?\nfunction calc[\s\S]*?\n}\n/)[0];
const calc = new Function("state", src + "; return calc;")({ settings: { abzugAnwenden: true, faktor: 1.189, basisfeuchte: 13 } });

// Menge dt, Feuchte %, Nassmenge dt, Trockenmenge dt (so wie auf dem Kontoauszug)
const rows = [
  [270.80, 32.8, 269.18, 205.81], [259.40, 32.6, 257.84, 197.75], [266.80, 31.1, 265.20, 208.13],
  [263.80, 33.9, 262.22, 197.06], [263.20, 32.8, 261.62, 200.03], [270.40, 32.1, 268.78, 207.74],
  [260.80, 32.5, 259.24, 199.13], [266.40, 33.8, 264.80, 199.31], [263.60, 35.1, 262.02, 193.17],
  [258.60, 34.0, 257.05, 192.87], [253.80, 33.6, 252.28, 190.49], [255.20, 34.9, 253.67, 187.62],
  [250.80, 29.3, 249.30, 200.98], [260.40, 29.4, 258.84, 208.37], [227.60, 28.0, 226.23, 185.89],
  [228.00, 31.7, 226.63, 176.24], [238.00, 31.3, 236.57, 185.10], [250.60, 29.1, 249.10, 201.41],
  [239.80, 26.7, 238.36, 199.53], [247.60, 26.8, 246.11, 205.73], [250.80, 29.0, 249.30, 201.87],
  [277.80, 27.5, 276.13, 228.53], [236.40, 27.8, 234.98, 193.63],
];
let bad = 0;
for (const [m, f, nass, trocken] of rows) {
  const c = calc({ netto: m * 100, feuchte: f, abzug: 0.6 });
  const n2 = Math.round(c.bereinigt) / 100, t2 = Math.round(c.tm) / 100;
  if (n2 !== nass || t2 !== trocken) { bad++; console.log("ABWEICHUNG", { m, f, nass, n2, trocken, t2 }); }
}
console.log(bad ? `${bad} von ${rows.length} Zeilen weichen ab` : `Alle ${rows.length} Zeilen des Kontoauszugs stimmen aufs Hundertstel`);
process.exit(bad ? 1 : 0);
