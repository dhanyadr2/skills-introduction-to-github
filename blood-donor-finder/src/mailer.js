import nodemailer from 'nodemailer';
import { nowIso } from './db.js';

/**
 * Sends email over SMTP when configured. Every message is also written to the
 * outbox table so it can be inspected at /dev/outbox during development.
 */
export function createMailer(db, config) {
  const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;
  const insert = db.prepare('INSERT INTO outbox (to_addr, subject, body, created_at) VALUES (?, ?, ?, ?)');

  return {
    async send({ to, subject, text }) {
      insert.run(to, subject, text, nowIso());
      if (transport) {
        await transport.sendMail({ from: config.mailFrom, to, subject, text });
      } else if (!config.quiet) {
        console.log(`[mail] to=${to} subject="${subject}" (not sent: SMTP not configured; see /dev/outbox)`);
      }
    },
  };
}
