import React, { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { exportTableToExcel, exportTableToPdf } from '../utils/tableExport';
import type { ExportColumn } from '../utils/tableExport';

type Format = 'PDF' | 'EXCEL';

type Props<T> = {
  title: string;
  filenameBase: string; // without extension
  subtitle?: string;
  filters?: Record<string, any>;
  columns: ExportColumn<T>[];
  rows: T[];
  totalLabel?: string; // e.g. "Tous les résultats"
  totalCount?: number;
  fetchAll?: () => Promise<T[]>;
  orientation?: 'portrait' | 'landscape';
  disabled?: boolean;
};

function safeFilename(s: string) {
  return s
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
    .slice(0, 120);
}

export function ExportButtons<T>(props: Props<T>) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>('PDF');
  const [exporting, setExporting] = useState(false);
  const hasAll = !!props.fetchAll && (props.totalCount ?? 0) > props.rows.length;

  const today = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const base = safeFilename(`${props.filenameBase}_${today}`);

  const runExport = async (scope: 'PAGE' | 'ALL') => {
    setExporting(true);
    try {
      const data = scope === 'ALL' && props.fetchAll ? await props.fetchAll() : props.rows;

      if (format === 'PDF') {
        await exportTableToPdf({
          filename: `${base}.pdf`,
          title: props.title,
          subtitle: props.subtitle,
          filters: props.filters,
          columns: props.columns,
          rows: data,
          orientation: props.orientation,
        });
      } else {
        exportTableToExcel({
          filename: `${base}.xlsx`,
          sheetName: props.title,
          columns: props.columns,
          rows: data,
        });
      }
      setOpen(false);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          className="btn"
          onClick={() => {
            setFormat('PDF');
            setOpen(true);
          }}
          disabled={props.disabled || exporting}
          title="Exporter en PDF"
        >
          PDF
        </button>
        <button
          className="btn"
          onClick={() => {
            setFormat('EXCEL');
            setOpen(true);
          }}
          disabled={props.disabled || exporting}
          title="Exporter en Excel"
        >
          Excel
        </button>
      </div>

      <Modal
        open={open}
        onClose={() => (exporting ? null : setOpen(false))}
        title={`Exporter — ${format === 'PDF' ? 'PDF' : 'Excel'}`}
        width={520}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)} disabled={exporting}>
              Annuler
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="muted">
            Choisissez si vous voulez exporter la page courante ou tous les résultats (avec les filtres appliqués).
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              className="btn primary"
              onClick={() => runExport('PAGE')}
              disabled={exporting || props.rows.length === 0}
            >
              Page courante ({props.rows.length})
            </button>

            <button
              className={hasAll ? 'btn' : 'btn muted'}
              onClick={() => runExport('ALL')}
              disabled={exporting || !props.fetchAll || (props.totalCount ?? props.rows.length) === 0}
              title={!props.fetchAll ? 'Export total non disponible' : undefined}
            >
              {props.totalLabel ?? 'Tous'} ({props.totalCount ?? '—'})
            </button>
          </div>

          {hasAll ? (
            <div className="badge">
              Astuce: l’export « Tous » peut prendre quelques secondes si la liste est grande.
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
