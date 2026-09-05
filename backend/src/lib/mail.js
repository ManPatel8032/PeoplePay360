/**
 * Payslip delivery. With SMTP_HOST set it sends for real; without it, mail is
 * written to server/outbox/ and logged — so the demo works on venue wifi that
 * blocks SMTP, and judges can still open the generated PDFs.
 */
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX = path.join(__dirname, '..', '..', 'outbox');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export async function sendPayslipMail(slip, pdfBuffer) {
  const filename = `payslip-${slip.employee_name.replace(/\W+/g, '-')}-${slip.period_start}.pdf`;
  const message = {
    from: process.env.MAIL_FROM || 'payroll@peoplepay360.local',
    to: slip.work_email,
    subject: `Payslip — ${slip.period_start} to ${slip.period_end}`,
    text: `Hi ${slip.employee_name},\n\nYour payslip for ${slip.period_start} – ${slip.period_end} is attached.\nNet payable: ${money(slip.net)}\n\n— PeoplePay360 Payroll`,
    attachments: [{ filename, content: pdfBuffer }],
  };

  if (transport) {
    const info = await transport.sendMail(message);
    return { mode: 'smtp', to: slip.work_email, messageId: info.messageId };
  }

  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, filename);
  fs.writeFileSync(file, pdfBuffer);
  console.log(`[mail:outbox] ${slip.work_email} <- ${filename}`);
  return { mode: 'outbox', to: slip.work_email, file };
}
