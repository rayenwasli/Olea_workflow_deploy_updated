import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { http } from '../api/http';
import type { BordereauStatus, ClientDto, NumericStats, RoleName } from '../types';

const OLEA_BROWN: [number, number, number] = [156, 61, 37];
const OLEA_GOLD: [number, number, number] = [255, 184, 44];

const WORKFLOW: BordereauStatus[] = [
  'CREE',
  'RECUPERE_BO',
  'DEPOSE_SCAN',
  'SCANNE',
  'VERIFIE',
  'PRET_A_ENVOYER',
  'RECU_DU_RESPONSABLE',
  'DONNE_AU_COURSIER',
  'FINALISE',
  'VALIDE',
];

const STATUS_LABEL: Record<BordereauStatus, string> = {
  CREE: 'Créé',
  RECUPERE_BO: 'Récupéré (BO)',
  DEPOSE_SCAN: 'Déposé au scan',
  SCANNE: 'Scanné',
  VERIFIE: 'Vérifié',
  A_RENVOYER_AU_CLIENT: 'À renvoyer au client',
  RENVOYE_AU_CLIENT: 'Renvoyé au client',
  RECU_DU_CLIENT: 'Reçu du client',
  PRET_A_ENVOYER: 'Prêt à envoyer',
  RECU_DU_RESPONSABLE: 'Reçu du responsable',
  DONNE_AU_COURSIER: 'Donné au coursier',
  FINALISE: 'Finalisé',
  VALIDE: 'Validé',
};

const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: 'Admin',
  BUREAU_ORDRE: "Bureau d'ordre",
  COORDINATEUR: 'Coordinateur',
  SCANNER: 'Scanner',
  VERIFICATEUR: 'Vérificateur',
  RESPONSABLE_CLIENT: 'Responsable client',
  RESPONSABLE_CLIENT_PROD: 'Responsable client prod',
  COURSIER: 'Coursier',
};

function toIsoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

function safeFilename(s: string) {
  return s
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
    .slice(0, 120);
}

export function AdminNumericStats() {
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [data, setData] = useState<NumericStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(() => toIsoDate(new Date(Date.now() - 30 * 24 * 3600 * 1000)));
  const [to, setTo] = useState(() => toIsoDate(new Date()));
  const [bucket, setBucket] = useState<'DAY' | 'WEEK'>('DAY');
  const [clientId, setClientId] = useState<number | 'ALL'>('ALL');
  const [priority, setPriority] = useState<'ALL' | 'TRUE' | 'FALSE'>('ALL');

  useEffect(() => {
    http
      .get<ClientDto[]>('/admin/clients')
      .then((r) => setClients(r.data))
      .catch(() => setClients([]));
  }, []);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await http.get<NumericStats>('/admin/dashboard/numeric', {
        params: {
          from,
          to,
          bucket,
          clientId: clientId === 'ALL' ? undefined : clientId,
          priority: priority === 'ALL' ? undefined : priority === 'TRUE',
        },
      });
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => reload(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, bucket, clientId, priority]);

  const clientLabel = useMemo(() => {
    if (clientId === 'ALL') return 'Tous';
    return clients.find((c) => c.id === clientId)?.name ?? `Client #${clientId}`;
  }, [clientId, clients]);

  const prioLabel = useMemo(() => {
    if (priority === 'ALL') return 'Toutes';
    return priority === 'TRUE' ? 'Prioritaires' : 'Non prioritaires';
  }, [priority]);

  const bucketLabel = bucket === 'DAY' ? 'Jour' : 'Semaine';

  const byRoleOrdered = useMemo(() => {
    const rows = data?.byRole ?? [];
    // Keep a stable order (close to workflow responsibilities)
    const order: RoleName[] = ['BUREAU_ORDRE', 'COORDINATEUR', 'SCANNER', 'VERIFICATEUR', 'RESPONSABLE_CLIENT', 'RESPONSABLE_CLIENT_PROD', 'COURSIER'];
    return [...rows].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  }, [data]);

  const byStatusOrdered = useMemo(() => {
    const rows = data?.byStatus ?? [];
    const map = new Map(rows.map((r) => [r.status, r]));
    const out: any[] = [];
    for (const s of WORKFLOW) {
      const r = map.get(s);
      if (r) out.push(r);
      else out.push({ status: s, count: 0, avgHours: 0, samples: 0 });
    }
    // Any extra statuses (shouldn't happen) appended
    for (const r of rows) {
      if (!WORKFLOW.includes(r.status as any)) out.push(r);
    }
    return out;
  }, [data]);

  const exportPdf = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const logo = await loadImageAsDataUrl('/olea-logo.jpg');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 44;

      const generatedAt = new Date().toLocaleString('fr-FR');
      const title = 'DocuFlow — Statistiques numériques';
      // Normalize dates for PDF (remove any stray spacing) and avoid unicode arrows.
      const cleanFrom = String(from ?? '').replace(/\s+/g, '');
      const cleanTo = String(to ?? '').replace(/\s+/g, '');
      const period = `${cleanFrom} - ${cleanTo}`;

      const drawHeader = (subtitle?: string) => {
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, W, 86, 'F');
        doc.setFillColor(...OLEA_BROWN);
        doc.rect(0, 0, W, 8, 'F');

        if (logo) {
          try {
            const fmt = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(logo, fmt as any, M, 20, 44, 44);
          } catch {}
        }

        const x = M + (logo ? 58 : 0);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(title, x, 46);

        if (subtitle) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(71, 85, 105);
          doc.text(subtitle, x, 63);
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        (doc as any).setCharSpace?.(0);
        doc.text(`Généré le ${generatedAt}`, W - M, 30, { align: 'right' });

        // Period (text only) — removed the yellow chip
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        (doc as any).setCharSpace?.(0);
        doc.text(`Période: ${period}`, W - M, 46, { align: 'right' });
      };

      // Cover-like first block
      drawHeader('Synthèse (chiffres) — export PDF/Excel');

      // Filters
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Filtres', M, 108);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      (doc as any).setCharSpace?.(0);
      doc.text(`Période: ${period}`, M, 126);
      doc.text(`Client: ${clientLabel}`, M, 142);
      doc.text(`Priorité: ${prioLabel} • Bucket: ${bucketLabel}`, M, 158);

      // KPI cards
      const kpis = [
        { label: 'Total bordereaux', value: String(data.kpis.totalBordereaux) },
        { label: 'Backlog', value: String(data.kpis.backlog) },
        { label: 'Prioritaires', value: String(data.kpis.priorityCount) },
        { label: 'En cours (24h)', value: String(data.kpis.inProgressToday) },
        { label: 'En cours (7j)', value: String(data.kpis.inProgressWeek) },
        { label: 'Cycle moyen (h)', value: data.kpis.avgCycleHours == null ? '—' : String(data.kpis.avgCycleHours) },
      ];

      const gap = 14;
      const cols = 3;
      const cardW = (W - 2 * M - (cols - 1) * gap) / cols;
      const cardH = 62;
      const y0 = 176;

      for (let i = 0; i < kpis.length; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = M + c * (cardW + gap);
        const y = y0 + r * (cardH + gap);
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, y, cardW, cardH, 12, 12, 'FD');
        doc.setTextColor(100, 116, 139);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(kpis[i].label.toUpperCase(), x + 14, y + 22);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(kpis[i].value, x + 14, y + 48);
      }

      // Tables (Role + Status)
      let y = y0 + 2 * (cardH + gap) + 18;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('KPIs par rôle', M, y);
      y += 10;

      autoTable(doc as any, {
        startY: y,
        margin: { left: M, right: M },
        head: [[
          'Rôle',
          'Backlog (bordereaux)',
          'Backlog (documents)',
          'Attente moy. (j)',
          'Plus ancien (j)',
          'Traités (période)',
        ]],
        body: byRoleOrdered.map((r) => [
          ROLE_LABEL[r.role] ?? r.role,
          String(r.backlogBordereaux ?? 0),
          String(r.backlogDocuments ?? 0),
          String(r.avgWaitDays ?? 0),
          String(r.maxWaitDays ?? 0),
          String(r.processedInRange ?? 0),
        ]),
        styles: {
          font: 'helvetica',
          fontSize: 9,
          textColor: [15, 23, 42],
          cellPadding: 6,
        },
        headStyles: {
          fillColor: OLEA_BROWN as any,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        theme: 'grid',
        didDrawPage: () => {
          // Header/footer on each page
          const pageCount = doc.getNumberOfPages();
          const page = (doc as any).internal?.getCurrentPageInfo?.().pageNumber ?? 1;

          // Header
          drawHeader('Synthèse (chiffres) — export PDF/Excel');

          // Footer
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${page} / ${pageCount}`, W / 2, H - 16, { align: 'center' });
          doc.setTextColor(203, 213, 225);
          doc.text('OLEA', W - M, H - 16, { align: 'right' });
        },
      } as any);

      // Status table below (or new page if needed)
      const lastY = (doc as any).lastAutoTable?.finalY ?? 200;
      let y2 = lastY + 24;
      if (y2 > H - 200) {
        doc.addPage();
        drawHeader('Synthèse (chiffres) — export PDF/Excel');
        y2 = 110;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('KPIs par statut', M, y2);
      y2 += 10;

      autoTable(doc as any, {
        startY: y2,
        margin: { left: M, right: M },
        head: [['Statut', 'Bordereaux (actuel)', 'Temps moyen (h)', 'Échantillons']],
        body: byStatusOrdered.map((r) => [
          STATUS_LABEL[r.status as BordereauStatus] ?? r.status,
          String(r.count ?? 0),
          String(r.avgHours ?? 0),
          String(r.samples ?? 0),
        ]),
        styles: {
          font: 'helvetica',
          fontSize: 9,
          textColor: [15, 23, 42],
          cellPadding: 6,
        },
        headStyles: {
          fillColor: OLEA_BROWN as any,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        theme: 'grid',
        didDrawPage: () => {
          const pageCount = doc.getNumberOfPages();
          const page = (doc as any).internal?.getCurrentPageInfo?.().pageNumber ?? 1;
          drawHeader('Synthèse (chiffres) — export PDF/Excel');
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${page} / ${pageCount}`, W / 2, H - 16, { align: 'center' });
          doc.setTextColor(203, 213, 225);
          doc.text('OLEA', W - M, H - 16, { align: 'right' });
        },
      } as any);

      const base = safeFilename(`stats_numeriques_${cleanFrom}_to_${cleanTo}`);
      doc.save(`${base}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  const exportExcel = () => {
    if (!data) return;

    const cleanFrom = String(from ?? '').replace(/\s+/g, '');
    const cleanTo = String(to ?? '').replace(/\s+/g, '');

    const wb = XLSX.utils.book_new();

    // KPIs sheet
    const kpiRows = [
      ['Clé', 'Valeur'],
      ['Période', `${cleanFrom} - ${cleanTo}`],
      ['Client', clientLabel],
      ['Priorité', prioLabel],
      ['Bucket', bucketLabel],
      ['Total bordereaux', data.kpis.totalBordereaux],
      ['Backlog', data.kpis.backlog],
      ['Prioritaires', data.kpis.priorityCount],
      ['En cours (24h)', data.kpis.inProgressToday],
      ['En cours (7j)', data.kpis.inProgressWeek],
      ['Cycle moyen (h)', data.kpis.avgCycleHours ?? ''],
      ['Bottleneck', data.bottleneck?.status ?? ''],
      ['Bottleneck (h)', data.bottleneck?.avgHours ?? ''],
      ['Bottleneck (samples)', data.bottleneck?.samples ?? ''],
    ];
    const wsKpi = XLSX.utils.aoa_to_sheet(kpiRows);
    (wsKpi as any)['!cols'] = [{ wch: 26 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, wsKpi, 'KPIs');

    // Role sheet
    const roleAoa: any[][] = [
      ['Rôle', 'Backlog (bordereaux)', 'Backlog (documents)', 'Attente moy. (j)', 'Plus ancien (j)', 'Traités (période)'],
      ...byRoleOrdered.map((r) => [
        ROLE_LABEL[r.role] ?? r.role,
        r.backlogBordereaux,
        r.backlogDocuments,
        r.avgWaitDays,
        r.maxWaitDays,
        r.processedInRange,
      ]),
    ];
    const wsRole = XLSX.utils.aoa_to_sheet(roleAoa);
    (wsRole as any)['!autofilter'] = { ref: `A1:F1` };
    (wsRole as any)['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsRole, 'Par rôle');

    // Status sheet
    const statusAoa: any[][] = [
      ['Statut', 'Bordereaux (actuel)', 'Temps moyen (h)', 'Échantillons'],
      ...byStatusOrdered.map((r) => [
        STATUS_LABEL[r.status as BordereauStatus] ?? r.status,
        r.count,
        r.avgHours,
        r.samples,
      ]),
    ];
    const wsStatus = XLSX.utils.aoa_to_sheet(statusAoa);
    (wsStatus as any)['!autofilter'] = { ref: `A1:D1` };
    (wsStatus as any)['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsStatus, 'Par statut');

    const base = safeFilename(`stats_numeriques_${cleanFrom}_to_${cleanTo}`);
    XLSX.writeFile(wb, `${base}.xlsx`, { compression: true });
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xl font-black tracking-tight text-slate-900">Statistiques numériques</div>
            <div className="muted mt-1 text-sm">
              Vue chiffres — KPIs + tableaux (export PDF/Excel)
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading || exporting}>
              {loading ? '…' : 'Recharger'}
            </button>
            <button className="btn" onClick={exportExcel} disabled={!data || loading || exporting}>
              Excel
            </button>
            <button className="btn primary" onClick={exportPdf} disabled={!data || loading || exporting}>
              {exporting ? 'Export…' : 'PDF'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-5">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200/60">
            <span className="text-[11px] font-bold text-slate-600">Du</span>
            <input className="input h-9 flex-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200/60">
            <span className="text-[11px] font-bold text-slate-600">Au</span>
            <input className="input h-9 flex-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200/60">
            <span className="text-[11px] font-bold text-slate-600">Client</span>
            <select
              className="input h-9 flex-1"
              value={clientId}
              onChange={(e) => setClientId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
            >
              <option value="ALL">Tous</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200/60">
            <span className="text-[11px] font-bold text-slate-600">Prio</span>
            <select className="input h-9 flex-1" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="ALL">Toutes</option>
              <option value="TRUE">Oui</option>
              <option value="FALSE">Non</option>
            </select>
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200/60">
            <span className="text-[11px] font-bold text-slate-600">Bucket</span>
            <select className="input h-9 flex-1" value={bucket} onChange={(e) => setBucket(e.target.value as any)}>
              <option value="DAY">Jour</option>
              <option value="WEEK">Semaine</option>
            </select>
          </div>
        </div>

        {error ? <div className="mt-3 badge danger">{error}</div> : null}

        {data ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Total</div>
              <div className="mt-1 text-lg font-black text-slate-900">{data.kpis.totalBordereaux}</div>
            </div>
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Backlog</div>
              <div className="mt-1 text-lg font-black text-slate-900">{data.kpis.backlog}</div>
            </div>
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Prioritaires</div>
              <div className="mt-1 text-lg font-black text-slate-900">{data.kpis.priorityCount}</div>
            </div>
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">En cours 24h</div>
              <div className="mt-1 text-lg font-black text-slate-900">{data.kpis.inProgressToday}</div>
            </div>
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">En cours 7j</div>
              <div className="mt-1 text-lg font-black text-slate-900">{data.kpis.inProgressWeek}</div>
            </div>
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/60">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Cycle (h)</div>
              <div className="mt-1 text-lg font-black text-slate-900">{data.kpis.avgCycleHours ?? '—'}</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Table: by role */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-slate-900">KPIs par rôle</div>
            <div className="muted mt-1 text-xs">Backlog + attente + throughput (période)</div>
          </div>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="py-2 pr-3">Rôle</th>
                <th className="py-2 pr-3">Backlog (bordereaux)</th>
                <th className="py-2 pr-3">Backlog (documents)</th>
                <th className="py-2 pr-3">Attente moy. (j)</th>
                <th className="py-2 pr-3">Plus ancien (j)</th>
                <th className="py-2 pr-3">Traités (période)</th>
              </tr>
            </thead>
            <tbody>
              {byRoleOrdered.map((r) => (
                <tr key={r.role} className="border-t border-slate-200/70">
                  <td className="py-2 pr-3 font-semibold">{ROLE_LABEL[r.role] ?? r.role}</td>
                  <td className="py-2 pr-3">{r.backlogBordereaux}</td>
                  <td className="py-2 pr-3">{r.backlogDocuments}</td>
                  <td className="py-2 pr-3">{r.avgWaitDays}</td>
                  <td className="py-2 pr-3">{r.maxWaitDays}</td>
                  <td className="py-2 pr-3">{r.processedInRange}</td>
                </tr>
              ))}
              {!byRoleOrdered.length ? (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={6}>
                    {loading ? 'Chargement…' : 'Aucune donnée'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Table: by status */}
      <div className="card p-5">
        <div>
          <div className="text-sm font-black text-slate-900">KPIs par statut</div>
          <div className="muted mt-1 text-xs">Effectif actuel + temps moyen (h) sur la période</div>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="py-2 pr-3">Statut</th>
                <th className="py-2 pr-3">Bordereaux</th>
                <th className="py-2 pr-3">Temps moyen (h)</th>
                <th className="py-2 pr-3">Échantillons</th>
              </tr>
            </thead>
            <tbody>
              {byStatusOrdered.map((r) => (
                <tr key={r.status} className="border-t border-slate-200/70">
                  <td className="py-2 pr-3 font-semibold">{STATUS_LABEL[r.status as BordereauStatus] ?? r.status}</td>
                  <td className="py-2 pr-3">{r.count}</td>
                  <td className="py-2 pr-3">{r.avgHours}</td>
                  <td className="py-2 pr-3">{r.samples}</td>
                </tr>
              ))}
              {!byStatusOrdered.length ? (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={4}>
                    {loading ? 'Chargement…' : 'Aucune donnée'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
