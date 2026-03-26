const fs = require('fs');
const path = require('path');

const outputDir = process.env.BON_REMISE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'bon-remise');
const outputUrlPrefixRaw = process.env.BON_REMISE_UPLOAD_URL_PREFIX || '/uploads/bon-remise/';
const outputUrlPrefix = outputUrlPrefixRaw.endsWith('/') ? outputUrlPrefixRaw : `${outputUrlPrefixRaw}/`;

fs.mkdirSync(outputDir, { recursive: true });

const PAGE = { width: 595, height: 842, margin: 34 };
const BRAND = {
  olea900: [123, 46, 26],
  olea800: [156, 61, 37],
  olea700: [180, 72, 43],
  olea500: [250, 161, 57],
  olea100: [255, 233, 220],
  olea50: [255, 247, 242],
  slate900: [15, 23, 42],
  slate700: [51, 65, 85],
  slate500: [100, 116, 139],
  slate300: [203, 213, 225],
  slate200: [226, 232, 240],
  slate100: [241, 245, 249],
  white: [255, 255, 255],
  emeraldSoft: [236, 253, 245],
  emeraldLine: [167, 243, 208],
};
const TZ = process.env.APP_TIMEZONE || 'Africa/Tunis';
const logoPath = path.resolve(__dirname, '../../../frontend/olea-logo.jpg');
const logoExists = false && fs.existsSync(logoPath);

function safeText(v) {
  return String(v ?? '').trim();
}

function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(d);
}

function pdfEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ');
}

function stripAccents(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sanitizePdfText(text) {
  const normalized = stripAccents(String(text ?? ''))
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/[–—]/g, '-')
    .replace(/’/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/•/g, '-')
    .replace(/\u00a0/g, ' ');
  return normalized.replace(/[^\x20-\x7E]/g, ' ');
}

function rgbFill(rgb) {
  const [r, g, b] = rgb.map((v) => (v / 255).toFixed(3));
  return `${r} ${g} ${b} rg`;
}

function rgbStroke(rgb) {
  const [r, g, b] = rgb.map((v) => (v / 255).toFixed(3));
  return `${r} ${g} ${b} RG`;
}

function textWidthApprox(text, fontSize = 12, weight = 'normal') {
  const clean = sanitizePdfText(text);
  const factor = weight === 'bold' ? 0.56 : 0.515;
  return clean.length * fontSize * factor;
}

function breakWord(word, maxWidth, fontSize = 11, weight = 'normal') {
  const pieces = [];
  let current = '';
  for (const ch of word) {
    const candidate = current + ch;
    if (textWidthApprox(candidate, fontSize, weight) <= maxWidth || !current) current = candidate;
    else {
      pieces.push(current);
      current = ch;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapText(text, maxWidth, fontSize = 11, weight = 'normal') {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidates = textWidthApprox(word, fontSize, weight) > maxWidth ? breakWord(word, maxWidth, fontSize, weight) : [word];
    for (const part of candidates) {
      if (!current) {
        current = part;
        continue;
      }
      const next = `${current} ${part}`;
      if (textWidthApprox(next, fontSize, weight) <= maxWidth) current = next;
      else {
        lines.push(current);
        current = part;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawRect(x, y, w, h, fill = null, stroke = null, lineWidth = 1) {
  const cmds = ['q'];
  if (fill) cmds.push(rgbFill(fill));
  if (stroke) {
    cmds.push(rgbStroke(stroke));
    cmds.push(`${lineWidth} w`);
  }
  cmds.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  cmds.push('Q');
  return cmds.join('\n');
}

function drawRoundedRect(x, y, w, h, r, fill = null, stroke = null, lineWidth = 1) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const c = 0.5522847498 * radius;
  const cmds = ['q'];
  if (fill) cmds.push(rgbFill(fill));
  if (stroke) {
    cmds.push(rgbStroke(stroke));
    cmds.push(`${lineWidth} w`);
  }
  cmds.push(`${(x + radius).toFixed(2)} ${y.toFixed(2)} m`);
  cmds.push(`${(x + w - radius).toFixed(2)} ${y.toFixed(2)} l`);
  cmds.push(`${(x + w - radius + c).toFixed(2)} ${y.toFixed(2)} ${(x + w).toFixed(2)} ${(y + radius - c).toFixed(2)} ${(x + w).toFixed(2)} ${(y + radius).toFixed(2)} c`);
  cmds.push(`${(x + w).toFixed(2)} ${(y + h - radius).toFixed(2)} l`);
  cmds.push(`${(x + w).toFixed(2)} ${(y + h - radius + c).toFixed(2)} ${(x + w - radius + c).toFixed(2)} ${(y + h).toFixed(2)} ${(x + w - radius).toFixed(2)} ${(y + h).toFixed(2)} c`);
  cmds.push(`${(x + radius).toFixed(2)} ${(y + h).toFixed(2)} l`);
  cmds.push(`${(x + radius - c).toFixed(2)} ${(y + h).toFixed(2)} ${x.toFixed(2)} ${(y + h - radius + c).toFixed(2)} ${x.toFixed(2)} ${(y + h - radius).toFixed(2)} c`);
  cmds.push(`${x.toFixed(2)} ${(y + radius).toFixed(2)} l`);
  cmds.push(`${x.toFixed(2)} ${(y + radius - c).toFixed(2)} ${(x + radius - c).toFixed(2)} ${y.toFixed(2)} ${(x + radius).toFixed(2)} ${y.toFixed(2)} c`);
  cmds.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  cmds.push('Q');
  return cmds.join('\n');
}

function drawLine(x1, y1, x2, y2, stroke, lineWidth = 1) {
  return ['q', rgbStroke(stroke), `${lineWidth} w`, `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`, 'Q'].join('\n');
}

function drawText(text, x, y, opts = {}) {
  const fontSize = opts.fontSize || 12;
  const weight = opts.font === 'bold' ? 'bold' : 'normal';
  const font = opts.font === 'bold' ? 'F2' : 'F1';
  const color = opts.color || BRAND.slate900;
  const width = opts.maxWidth || null;
  const align = opts.align || 'left';
  const lines = width ? wrapText(text, width, fontSize, weight) : [sanitizePdfText(text)];
  const leading = opts.leading || Math.round(fontSize * 1.35);
  const cmds = [];
  let cy = y;
  for (const line of lines) {
    const safe = sanitizePdfText(line);
    let tx = x;
    if (align === 'center') tx = x - textWidthApprox(safe, fontSize, weight) / 2;
    if (align === 'right') tx = x - textWidthApprox(safe, fontSize, weight);
    cmds.push('BT');
    cmds.push(`/${font} ${fontSize} Tf`);
    cmds.push(rgbFill(color));
    cmds.push(`1 0 0 1 ${tx.toFixed(2)} ${cy.toFixed(2)} Tm`);
    cmds.push(`(${pdfEscape(safe)}) Tj`);
    cmds.push('ET');
    cy -= leading;
  }
  return { stream: cmds.join('\n'), height: lines.length * leading, lines, leading };
}

function drawImage(name, x, y, w, h) {
  return ['q', `${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`, `/${name} Do`, 'Q'].join('\n');
}

function fitWithin(width, height, maxW, maxH) {
  const ratio = Math.min(maxW / width, maxH / height);
  return { width: width * ratio, height: height * ratio };
}

function buildDocumentDefinition({ bordereau, depositInfo, generatedByEmail, generatedAt, comment }) {
  const docTypes = Array.isArray(depositInfo?.documentTypes) ? depositInfo.documentTypes : [];
  const normalizedDocTypes = docTypes.length ? docTypes.map((d) => ({
    type: safeText(d?.typeDocument) || 'Document',
    qty: Number(d?.nombre) || 0,
  })) : [{ type: 'Aucun type de document renseigne', qty: 0 }];

  const totalDocs = normalizedDocTypes.reduce((sum, item) => sum + (Number(item?.qty) || 0), 0);
  const refDepot = safeText(depositInfo?.depotReference || depositInfo?.depot_reference) || '-';
  const responsible = safeText(depositInfo?.responsable) || '-';
  const assureur = safeText(depositInfo?.assureur) || '-';
  const client = safeText(bordereau.clientName || bordereau.client_name) || '-';
  const reference = safeText(bordereau.reference) || `#${bordereau.id}`;

  return {
    title: 'BON DE REMISE',
    subtitle: 'Transmission Responsable Client -> Bureau d ordre',
    generatedAtLabel: formatDate(generatedAt),
    generatedByLabel: safeText(generatedByEmail) || 'Systeme',
    reference,
    client,
    assureur,
    refDepot,
    responsible,
    status: 'Recu du responsable client',
    totalDocs,
    docTypes: normalizedDocTypes,
    comment: safeText(comment) || '',
  };
}

function rowHeightForDoc(item, colWidth) {
  const wrapped = wrapText(item.type, colWidth, 10, 'normal');
  return Math.max(40, 18 + wrapped.length * 14);
}

function renderBonRemise(def) {
  const cmds = [];
  const innerW = PAGE.width - PAGE.margin * 2;
  const push = (s) => { if (s) cmds.push(s); };

  push(drawRect(0, 0, PAGE.width, PAGE.height, BRAND.olea50));
  push(drawRect(0, PAGE.height - 150, PAGE.width, 150, BRAND.olea800));
  push(drawRect(0, PAGE.height - 12, PAGE.width, 12, BRAND.olea500));

  // Decorative orbs
  push(drawRoundedRect(PAGE.width - 118, PAGE.height - 118, 170, 170, 85, [191, 103, 68]));
  push(drawRoundedRect(PAGE.width - 58, PAGE.height - 80, 110, 110, 55, [250, 161, 57]));
  push(drawRoundedRect(-30, PAGE.height - 120, 130, 130, 65, [180, 72, 43]));

  // Logo capsule
  push(drawRoundedRect(PAGE.margin, PAGE.height - 118, 188, 54, 18, [255, 255, 255], [255, 255, 255], 0.8));
  if (logoExists) {
    const logoFit = fitWithin(2048, 2048, 34, 34);
    push(drawImage('Im1', PAGE.margin + 12, PAGE.height - 108, logoFit.width, logoFit.height));
  } else {
    push(drawRoundedRect(PAGE.margin + 10, PAGE.height - 108, 34, 34, 10, BRAND.olea100, null));
    push(drawText('O', PAGE.margin + 27, PAGE.height - 96, { font: 'bold', fontSize: 18, color: BRAND.olea800, align: 'center' }).stream);
  }
  push(drawText('OLEA', PAGE.margin + 56, PAGE.height - 92, { font: 'bold', fontSize: 18, color: BRAND.olea900 }).stream);
  push(drawText('#BeAFRICA  ChooseOLEA', PAGE.margin + 56, PAGE.height - 107, { fontSize: 9, color: BRAND.slate500 }).stream);

  // Hero content
  push(drawText(def.title, PAGE.margin, PAGE.height - 142, { font: 'bold', fontSize: 24, color: BRAND.white }).stream);
  push(drawText(def.subtitle, PAGE.margin, PAGE.height - 166, { fontSize: 11, color: [255, 241, 231] }).stream);
  push(drawRoundedRect(PAGE.width - PAGE.margin - 166, PAGE.height - 118, 166, 52, 16, [255, 255, 255], null));
  push(drawText('Document systeme', PAGE.width - PAGE.margin - 152, PAGE.height - 88, { fontSize: 9, color: BRAND.slate500 }).stream);
  push(drawText(def.generatedAtLabel, PAGE.width - PAGE.margin - 152, PAGE.height - 104, { font: 'bold', fontSize: 11, color: BRAND.olea900 }).stream);

  let cursorTop = PAGE.height - 186;

  // Reference strip
  const refY = cursorTop - 34;
  push(drawRoundedRect(PAGE.margin, refY, innerW, 44, 16, BRAND.white, BRAND.slate200));
  push(drawRoundedRect(PAGE.margin + 12, refY + 9, 86, 26, 13, BRAND.olea100, null));
  push(drawText('Bordereau', PAGE.margin + 55, refY + 17, { font: 'bold', fontSize: 9, color: BRAND.olea800, align: 'center' }).stream);
  push(drawText(def.reference, PAGE.margin + 112, refY + 17, { font: 'bold', fontSize: 14, color: BRAND.slate900 }).stream);
  cursorTop = refY - 18;

  // Summary cards
  const gap = 14;
  const cardW = (innerW - gap * 2) / 3;
  const cardH = 78;
  const cardY = cursorTop - cardH;
  const cards = [
    { label: 'Client', value: def.client, accent: BRAND.olea800 },
    { label: 'Assureur', value: def.assureur, accent: BRAND.olea500 },
    { label: 'Total documents', value: String(def.totalDocs), accent: BRAND.olea900 },
  ];
  cards.forEach((card, i) => {
    const x = PAGE.margin + i * (cardW + gap);
    push(drawRoundedRect(x, cardY, cardW, cardH, 22, BRAND.white, BRAND.slate200));
    push(drawRoundedRect(x + 14, cardY + cardH - 24, 42, 8, 4, card.accent));
    push(drawText(card.label, x + 16, cardY + cardH - 42, { fontSize: 10, color: BRAND.slate500 }).stream);
    push(drawText(card.value, x + 16, cardY + cardH - 66, { font: 'bold', fontSize: 14, color: BRAND.slate900, maxWidth: cardW - 32 }).stream);
  });
  cursorTop = cardY - 18;

  // Two column info blocks
  const infoGap = 14;
  const infoW = (innerW - infoGap) / 2;
  const leftH = 126;
  const rightH = 126;
  const leftY = cursorTop - leftH;
  const rightY = cursorTop - rightH;
  push(drawRoundedRect(PAGE.margin, leftY, infoW, leftH, 22, BRAND.white, BRAND.slate200));
  push(drawRoundedRect(PAGE.margin + infoW + infoGap, rightY, infoW, rightH, 22, BRAND.white, BRAND.slate200));
  push(drawText('Informations de remise', PAGE.margin + 18, leftY + leftH - 28, { font: 'bold', fontSize: 14, color: BRAND.olea900 }).stream);
  push(drawText('Statut & traçabilite', PAGE.margin + infoW + infoGap + 18, rightY + rightH - 28, { font: 'bold', fontSize: 14, color: BRAND.olea900 }).stream);

  const leftFields = [
    ['Responsable client', def.responsible],
    ['Reference depot', def.refDepot],
  ];
  const rightFields = [
    ['Statut', def.status],
    ['Date de generation', def.generatedAtLabel],
  ];

  function drawFieldGroup(fields, baseX, topY, width) {
    let localY = topY;
    fields.forEach(([label, value], idx) => {
      push(drawText(label, baseX, localY, { fontSize: 9, color: BRAND.slate500 }).stream);
      const val = drawText(value, baseX, localY - 17, { font: 'bold', fontSize: 10, color: BRAND.slate900, maxWidth: width, leading: 13 });
      push(val.stream);
      localY -= 32 + Math.max(0, val.lines.length - 1) * 9;
    });
  }

  drawFieldGroup(leftFields, PAGE.margin + 18, leftY + leftH - 50, infoW - 36);
  drawFieldGroup(rightFields, PAGE.margin + infoW + infoGap + 18, rightY + rightH - 50, infoW - 36);
  cursorTop = leftY - 18;

  // Table section title
  push(drawText('Documents remis', PAGE.margin, cursorTop - 6, { font: 'bold', fontSize: 15, color: BRAND.olea900 }).stream);
  push(drawText('Synthese des pieces recues du responsable client.', PAGE.margin, cursorTop - 24, { fontSize: 10, color: BRAND.slate500 }).stream);
  cursorTop -= 44;

  const tableX = PAGE.margin;
  const tableW = innerW;
  const colTypeW = tableW * 0.73;
  const colQtyW = tableW * 0.27;
  const headerH = 34;
  const headerY = cursorTop - headerH;
  push(drawRoundedRect(tableX, headerY, tableW, headerH, 14, BRAND.olea800));
  push(drawText('Type de document', tableX + 16, headerY + 12, { font: 'bold', fontSize: 10, color: BRAND.white }).stream);
  push(drawText('Quantite', tableX + tableW - 18, headerY + 12, { font: 'bold', fontSize: 10, color: BRAND.white, align: 'right' }).stream);
  cursorTop = headerY - 6;

  def.docTypes.forEach((item, idx) => {
    const h = rowHeightForDoc(item, colTypeW - 32);
    const y = cursorTop - h;
    push(drawRoundedRect(tableX, y, tableW, h, 16, idx % 2 === 0 ? BRAND.white : [252, 250, 248], BRAND.slate200));
    const typeText = drawText(item.type, tableX + 16, y + h - 18, { fontSize: 10, color: BRAND.slate900, maxWidth: colTypeW - 32, leading: 14 });
    push(typeText.stream);
    push(drawRoundedRect(tableX + colTypeW + 12, y + (h - 28) / 2, colQtyW - 28, 28, 14, BRAND.olea100, null));
    push(drawText(String(item.qty), tableX + colTypeW + 12 + (colQtyW - 28) / 2, y + (h - 28) / 2 + 9, { font: 'bold', fontSize: 11, color: BRAND.olea900, align: 'center' }).stream);
    cursorTop = y - 8;
  });

  if (def.comment) {
    const maxCommentWidth = innerW - 36;
    const commentLinesRaw = wrapText(def.comment, maxCommentWidth, 10, 'normal');
    const commentLines = commentLinesRaw.slice(0, 2);
    const commentH = 58 + commentLines.length * 12;
    const commentY = Math.max(76, cursorTop - commentH - 10);
    push(drawRoundedRect(PAGE.margin, commentY, innerW, commentH, 20, BRAND.emeraldSoft, BRAND.emeraldLine));
    push(drawRoundedRect(PAGE.margin + 18, commentY + commentH - 30, 68, 20, 10, BRAND.white, null));
    push(drawText('Commentaire', PAGE.margin + 52, commentY + commentH - 23, { font: 'bold', fontSize: 9, color: BRAND.olea900, align: 'center' }).stream);
    push(drawText(commentLines.join(' '), PAGE.margin + 18, commentY + commentH - 42, { fontSize: 10, color: BRAND.slate900, maxWidth: maxCommentWidth, leading: 12 }).stream);
    cursorTop = commentY - 12;
  }

  // Footer
  push(drawLine(PAGE.margin, 52, PAGE.width - PAGE.margin, 52, BRAND.slate200));
  push(drawText('Bon de remise genere automatiquement par la plateforme OLEA.', PAGE.margin, 35, { fontSize: 9, color: BRAND.slate500 }).stream);
  push(drawText(def.reference, PAGE.width - PAGE.margin, 35, { font: 'bold', fontSize: 9, color: BRAND.olea900, align: 'right' }).stream);

  return cmds.join('\n');
}

function parseJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xD9 || marker === 0xDA) break;
    const len = buffer.readUInt16BE(offset + 2);
    if ([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + len;
  }
  throw new Error('Unable to parse JPEG dimensions');
}

function buildPdfBuffer({ streamContent, imageBuffer = null, imageMeta = null }) {
  const objects = [];
  const setObject = (id, body) => {
    objects[id] = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'binary');
  };

  const imageObjectId = imageBuffer && imageMeta ? 7 : null;
  const resources = imageObjectId
    ? `<< /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 ${imageObjectId} 0 R >> >>`
    : '<< /Font << /F1 4 0 R /F2 5 0 R >> >>';

  setObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  setObject(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  setObject(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources ${resources} /Contents 6 0 R >>`);
  setObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  setObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  setObject(6, `<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream`);

  if (imageObjectId) {
    const imgHeader = Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${imageMeta.width} /Height ${imageMeta.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBuffer.length} >>\nstream\n`, 'binary');
    const imgFooter = Buffer.from('\nendstream', 'binary');
    setObject(imageObjectId, Buffer.concat([imgHeader, imageBuffer, imgFooter]));
  }

  let pdf = Buffer.from('%PDF-1.4\n', 'binary');
  const offsets = [0];
  const objectCount = objects.length - 1;
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    const prefix = Buffer.from(`${index} 0 obj\n`, 'binary');
    const suffix = Buffer.from('\nendobj\n', 'binary');
    pdf = Buffer.concat([pdf, prefix, objects[index], suffix]);
  }
  const xrefOffset = pdf.length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objectCount; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  pdf = Buffer.concat([pdf, Buffer.from(xref + trailer, 'binary')]);
  return pdf;
}

async function generateBonRemisePdf({ bordereau, depositInfo, generatedByEmail, generatedAt, comment }) {
  const stamp = Date.now();
  const filename = `bon_remise_${bordereau.id}_${stamp}.pdf`;
  const absolutePath = path.join(outputDir, filename);
  const publicUrl = `${outputUrlPrefix}${filename}`;

  const def = buildDocumentDefinition({ bordereau, depositInfo, generatedByEmail, generatedAt, comment });
  const streamContent = renderBonRemise(def);

  let imageBuffer = null;
  let imageMeta = null;
  if (logoExists) {
    imageBuffer = await fs.promises.readFile(logoPath);
    imageMeta = parseJpegDimensions(imageBuffer);
  }

  const pdfBuffer = buildPdfBuffer({ streamContent, imageBuffer, imageMeta });
  await fs.promises.writeFile(absolutePath, pdfBuffer);

  return { absolutePath, publicUrl, filename };
}

module.exports = { generateBonRemisePdf, outputDir, outputUrlPrefix };
