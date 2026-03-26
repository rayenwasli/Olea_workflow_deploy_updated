import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export type ExportAlign = 'left' | 'center' | 'right';

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => any;
  align?: ExportAlign;
  // Approx width in points for PDF (optional)
  pdfWidth?: number;
};

const OLEA_BROWN: [number, number, number] = [156, 61, 37];

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function toText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (v instanceof Date) return v.toLocaleString('fr-FR');
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(', ');
  return String(v);
}

export async function exportTableToPdf<T>(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  filters?: Record<string, any>;
  columns: ExportColumn<T>[];
  rows: T[];
  orientation?: 'portrait' | 'landscape';
}) {
  const orientation = opts.orientation ?? (opts.columns.length >= 6 ? 'landscape' : 'portrait');
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;

  // Header
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, 86, 'F');
  doc.setFillColor(...OLEA_BROWN);
  doc.rect(0, 0, W, 8, 'F');

  const logo = await loadImageAsDataUrl('/olea-logo.jpg');
  if (logo) {
    try {
      const fmt = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(logo, fmt as any, M, 20, 42, 42);
    } catch {
      // ignore
    }
  }

  const titleX = M + (logo ? 54 : 0);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(opts.title, titleX, 46);

  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(opts.subtitle, titleX, 63);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, W - M, 30, { align: 'right' });

  // Filters block
  let y = 98;
  if (opts.filters && Object.keys(opts.filters).length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Filtres', M, y);
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);

    const lines = Object.entries(opts.filters)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => `${k}: ${String(v)}`);

    const maxWidth = W - 2 * M;
    for (const line of lines) {
      const chunks = doc.splitTextToSize(line, maxWidth);
      doc.text(chunks as any, M, y);
      y += 14 * chunks.length;
    }

    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y, W - M, y);
    y += 12;
  }

  const head = [opts.columns.map((c) => c.header)];
  const body = opts.rows.map((r) => opts.columns.map((c) => toText(c.value(r))));

  const columnStyles: any = {};
  opts.columns.forEach((c, i) => {
    columnStyles[i] = {
      halign: c.align ?? 'left',
      cellWidth: c.pdfWidth,
    };
  });

  autoTable(doc, {
    startY: Math.max(y, 98),
    head,
    body,
    margin: { left: M, right: M },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: [15, 23, 42],
      cellPadding: 6,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: OLEA_BROWN,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    bodyStyles: { fillColor: [255, 255, 255] },
    columnStyles,
    theme: 'grid',
    didDrawPage: (data) => {
      // Footer
      const pageCount = doc.getNumberOfPages();
      const page = (doc as any).internal?.getCurrentPageInfo?.().pageNumber ?? 1;
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${page} / ${pageCount}`, W / 2, H - 16, { align: 'center' });

      // Watermark-ish small brand
      doc.setTextColor(203, 213, 225);
      doc.text('OLEA', W - M, H - 16, { align: 'right' });
    },
  } as any);

  doc.save(opts.filename);
}

export function exportTableToExcel<T>(opts: {
  filename: string;
  sheetName?: string;
  columns: ExportColumn<T>[];
  rows: T[];
}) {
  const sheetName = (opts.sheetName ?? 'Données').slice(0, 31);

  const aoa: any[][] = [];
  aoa.push(opts.columns.map((c) => c.header));
  for (const r of opts.rows) {
    aoa.push(opts.columns.map((c) => {
      const v = c.value(r);
      if (v instanceof Date) return v.toLocaleString('fr-FR');
      if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
      if (Array.isArray(v)) return v.map(toText).join(', ');
      return v ?? '';
    }));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths (rough, but helps a lot)
  const colWidths = opts.columns.map((c, idx) => {
    const headerLen = (c.header ?? '').length;
    let maxLen = headerLen;
    for (let i = 1; i < Math.min(aoa.length, 200); i++) {
      const v = aoa[i][idx];
      const len = String(v ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 45) };
  });
  (ws as any)['!cols'] = colWidths;

  // Autofilter on header row
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + opts.columns.length - 1);
  (ws as any)['!autofilter'] = { ref: `A1:${lastCol}1` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, opts.filename, { compression: true });
}
