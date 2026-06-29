// Writes a giving receipt into an existing PDFKit document. Express-agnostic:
// the controller creates the document, pipes it to the response, calls this to
// lay out the content, then ends the document.

const CHURCH_NAME = 'AIC Ruiru'
const CHURCH_LOCATION = 'Ruiru, Kiambu County, Kenya'

function fmtKES(amount) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(amount) || 0)
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })
}

const PAYMENT_LABELS = { CASH: 'Cash', MPESA: 'M-Pesa', BANK_TRANSFER: 'Bank Transfer', CARD: 'Card', OTHER: 'Other' }

export function writeReceipt(doc, giving) {
  const accent = '#1f6f54'

  // Header
  doc.fillColor(accent).fontSize(22).font('Helvetica-Bold').text(CHURCH_NAME, { align: 'center' })
  doc.fillColor('#555').fontSize(10).font('Helvetica').text(CHURCH_LOCATION, { align: 'center' })
  doc.moveDown(0.5)
  doc.fillColor('#000').fontSize(14).font('Helvetica-Bold').text('Official Giving Receipt', { align: 'center' })
  doc.moveDown(1)

  // Rule
  doc.strokeColor(accent).lineWidth(1.5)
    .moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke()
  doc.moveDown(1)

  // Detail rows
  const rows = [
    ['Receipt No.', giving.receiptNo],
    ['Date Issued', fmtDate(giving.issuedAt)],
    ['Received From', giving.donorName],
    ['Date of Giving', fmtDate(giving.givenAt)],
    ['Project / Fund', giving.projectName || '—'],
    ['Payment Method', PAYMENT_LABELS[giving.paymentMethod] || giving.paymentMethod],
    ['Reference', giving.reference || '—'],
  ]
  if (giving.note) rows.push(['Note', giving.note])

  doc.fontSize(11)
  for (const [label, value] of rows) {
    const y = doc.y
    doc.font('Helvetica-Bold').fillColor('#444').text(label, doc.page.margins.left, y, { width: 150 })
    doc.font('Helvetica').fillColor('#000').text(String(value), doc.page.margins.left + 160, y, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 160,
    })
    doc.moveDown(0.5)
  }

  doc.moveDown(1)

  // Amount box
  const boxY = doc.y
  doc.roundedRect(doc.page.margins.left, boxY, doc.page.width - doc.page.margins.left - doc.page.margins.right, 44, 6)
    .fillAndStroke('#f2f8f5', accent)
  doc.fillColor(accent).fontSize(12).font('Helvetica-Bold')
    .text('Amount Received', doc.page.margins.left + 16, boxY + 14)
  doc.fillColor('#000').fontSize(18).font('Helvetica-Bold')
    .text(fmtKES(giving.amount), doc.page.margins.left, boxY + 11, {
      width: doc.page.width - doc.page.margins.right - doc.page.margins.left - 16,
      align: 'right',
    })

  doc.moveDown(4)

  // Footer
  doc.fillColor('#777').fontSize(9).font('Helvetica')
    .text('Thank you for your faithful giving. "Each of you should give what you have decided in your heart to give." — 2 Corinthians 9:7',
      { align: 'center' })
  doc.moveDown(0.5)
  doc.fillColor('#999').fontSize(8)
    .text('This is a computer-generated receipt and does not require a signature.', { align: 'center' })
}
