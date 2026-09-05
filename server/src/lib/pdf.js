import PDFDocument from 'pdfkit';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CAT_LABEL = { BASIC: 'Basic', ALW: 'Allowance', GROSS: 'Gross', DED: 'Deduction', NET: 'Net' };

/** Render a payslip to a PDF Buffer (B8). */
export function renderPayslipPdf(slip) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('PeoplePay360', { continued: true })
       .fontSize(11).fillColor('#64748b').text('   Payslip');
    doc.fillColor('#0f172a').moveDown(0.5);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#e2e8f0').stroke().moveDown(0.8);

    const kv = (label, value) => {
      doc.fontSize(9).fillColor('#64748b').text(label, { continued: true });
      doc.fontSize(9).fillColor('#0f172a').text(`  ${value ?? '—'}`);
    };

    const left = doc.y;
    doc.fontSize(14).fillColor('#0f172a').text(slip.employee_name).moveDown(0.3);
    kv('Department', slip.department_name);
    kv('Pay Run', slip.payrun_name);
    kv('Structure', slip.structure_name);
    const afterLeft = doc.y;

    doc.y = left;
    doc.fontSize(9).fillColor('#64748b').text('Period',      330, doc.y, { width: 220 });
    doc.fontSize(11).fillColor('#0f172a').text(`${slip.period_start} → ${slip.period_end}`, 330, doc.y, { width: 220 });
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor('#64748b').text('Worked days', 330, doc.y, { width: 220 });
    doc.fontSize(11).fillColor('#0f172a').text(`${slip.worked_days}  (leave: ${slip.leave_days})`, 330, doc.y, { width: 220 });
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor('#64748b').text('Status',      330, doc.y, { width: 220 });
    doc.fontSize(11).fillColor('#0f172a').text(String(slip.state).toUpperCase(), 330, doc.y, { width: 220 });

    doc.x = 48;
    doc.y = Math.max(afterLeft, doc.y) + 20;

    // Salary computation table
    doc.fontSize(12).fillColor('#0f172a').text('Salary Computation').moveDown(0.5);
    const tableTop = doc.y;
    doc.fontSize(9).fillColor('#64748b');
    doc.text('CODE', 48, tableTop).text('DESCRIPTION', 120, tableTop)
       .text('CATEGORY', 340, tableTop).text('AMOUNT', 440, tableTop, { width: 107, align: 'right' });
    doc.moveTo(48, tableTop + 14).lineTo(547, tableTop + 14).strokeColor('#e2e8f0').stroke();

    let y = tableTop + 22;
    for (const l of slip.lines) {
      const isTotal = l.category === 'GROSS' || l.category === 'NET';
      doc.fontSize(isTotal ? 10 : 9).fillColor(isTotal ? '#0f172a' : '#334155');
      doc.text(l.code, 48, y, { width: 70 })
         .text(l.name, 120, y, { width: 215 })
         .text(CAT_LABEL[l.category] || l.category, 340, y, { width: 95 })
         .text(money(l.amount), 440, y, { width: 107, align: 'right' });
      y += 16;
      if (isTotal) { doc.moveTo(48, y - 3).lineTo(547, y - 3).strokeColor('#e2e8f0').stroke(); y += 4; }
      if (y > 720) { doc.addPage(); y = 60; }
    }

    y += 8;
    doc.rect(340, y, 207, 34).fill('#4f46e5');
    doc.fillColor('#ffffff').fontSize(10).text('NET PAYABLE', 352, y + 6);
    doc.fontSize(14).text(money(slip.net), 352, y + 16, { width: 183, align: 'right' });
    doc.fillColor('#0f172a');
    y += 50;

    const warnings = (slip.warnings || []).filter((w) => w.level !== 'info');
    if (warnings.length) {
      doc.fontSize(10).fillColor('#d97706').text('Warnings', 48, y);
      y += 14;
      for (const w of warnings) {
        doc.fontSize(8).fillColor('#92400e').text(`• ${w.message}`, 48, y, { width: 480 });
        y += 12;
      }
    }

    doc.fontSize(7).fillColor('#94a3b8')
       .text('Computer-generated payslip — PeoplePay360', 48, 780, { width: 499, align: 'center' });
    doc.end();
  });
}
