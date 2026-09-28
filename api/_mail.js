// E-Mail-Versand über SMTP (z. B. Microsoft 365 mit info@blickwinkel.pro oder Resend).
// Einstellungen in Vercel → Settings → Environment Variables:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM (sonst SMTP_USER)
// Ohne SMTP_HOST ist der Versand aus; die App zeigt dann den Hinweis auf info@blickwinkel.pro.
import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST || "";
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || "";
const FROM = process.env.MAIL_FROM || USER;
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(HOST);

// Feste Adresse für Links in Mails – nie aus der Anfrage (Host-Kopfzeile) ableiten.
export const APP_URL = (process.env.APP_URL || "https://maisdoc.blickwinkel.pro").replace(/\/+$/, "");

export const mailReady = () => !!(HOST && FROM);

let transport = null;
export async function sendMail({ to, subject, text, html }) {
  if (!mailReady()) throw Object.assign(new Error("E-Mail-Versand ist nicht eingerichtet."), { status: 503, code: "no_mail" });
  if (!transport) {
    transport = nodemailer.createTransport({
      host: HOST, port: PORT, secure: PORT === 465, requireTLS: !LOCAL && PORT !== 465, ignoreTLS: LOCAL,
      auth: USER ? { user: USER, pass: process.env.SMTP_PASS || "" } : undefined,
    });
  }
  await transport.sendMail({ from: `MaisDoc <${FROM}>`, to, subject, text, html });
}
