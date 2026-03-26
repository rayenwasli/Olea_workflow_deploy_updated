import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';

import { http } from '../api/http';
import type { ClientDto, RoleDashboard, RoleName, BordereauStatus } from '../types';
import { Modal } from '../components/Modal';
import { ExportButtons } from '../components/ExportButtons';

const CHART_COLORS = [
  '#9c3d25',
  '#ffb82c',
  '#0ea5e9',
  '#10b981',
  '#6366f1',
  '#f43f5e',
  '#14b8a6',
  '#8b5cf6',
];

const ROLE_DASHBOARDS = [
  { role: 'BUREAU_ORDRE' as const, label: "Bureau d'ordre" },
  { role: 'COORDINATEUR' as const, label: 'Coordinateur' },
  { role: 'SCANNER' as const, label: 'Scanner' },
  { role: 'VERIFICATEUR' as const, label: 'Vérificateur' },
  { role: 'RESPONSABLE_CLIENT' as const, label: 'Responsable client' },
  { role: 'RESPONSABLE_CLIENT_PROD' as const, label: 'Responsable client prod' },
  { role: 'COURSIER' as const, label: 'Coursier' },
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
  RECU_DU_RESPONSABLE: 'Reçu (resp.)',
  DONNE_AU_COURSIER: 'Donné au coursier',
  FINALISE: 'Finalisé',
  VALIDE: 'Validé',
};

const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: 'Admin',
  RESPONSABLE_CLIENT: 'Responsable client',
  RESPONSABLE_CLIENT_PROD: 'Responsable client prod',
  COURSIER: 'Coursier',
  BUREAU_ORDRE: "Bureau d'ordre",
  COORDINATEUR: 'Coordinateur',
  VERIFICATEUR: 'Vérificateur',
  SCANNER: 'Scanner',
};

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const calc = () => setIsDesktop(window.matchMedia('(min-width: 1024px)').matches);
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return isDesktop;
}


function useAvailablePanelHeight() {
  const [h, setH] = useState<number | null>(null);

  useLayoutEffect(() => {
    const calc = () => {
      const header = document.querySelector('header');
      const main = document.querySelector('main');
      const headerH = header ? header.getBoundingClientRect().height : 0;
      const mainStyles = main ? window.getComputedStyle(main) : null;
      const padTop = mainStyles ? parseFloat(mainStyles.paddingTop || '0') : 0;
      const padBot = mainStyles ? parseFloat(mainStyles.paddingBottom || '0') : 0;
      const next = Math.max(1, Math.floor(window.innerHeight - headerH - padTop - padBot));
      setH(next);
    };

    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  return h;
}

function toIsoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function MiniKpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200/60">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  chartRef,
  children,
}: {
  title: string;
  subtitle?: string;
  chartRef?: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex min-h-0 flex-col p-3">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-black text-slate-900">{title}</div>
        {subtitle ? <div className="muted mt-0.5 truncate text-[10px]">{subtitle}</div> : null}
      </div>
      <div ref={chartRef as any} className="mt-2 flex-1 min-h-0 rounded-2xl bg-white p-1.5 ring-1 ring-slate-200/60">
        <div className="h-full w-full">{children}</div>
      </div>
    </div>
  );
}


type Captured = { dataUrl: string; width: number; height: number };

async function captureElement(el: HTMLElement): Promise<Captured> {
  const canvas = await html2canvas(el, {
    backgroundColor: '#ffffff',
    scale: 3,
    useCORS: true,
    allowTaint: true,
    logging: false,
  });
  return { dataUrl: canvas.toDataURL('image/png', 1.0), width: canvas.width, height: canvas.height };
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

function addImageContained(
  doc: jsPDF,
  img: Captured,
  format: 'PNG' | 'JPEG',
  x: number,
  y: number,
  w: number,
  h: number
) {
  const r = Math.min(w / img.width, h / img.height);
  const iw = img.width * r;
  const ih = img.height * r;
  const ix = x + (w - iw) / 2;
  const iy = y + (h - ih) / 2;
  doc.addImage(img.dataUrl, format, ix, iy, iw, ih);
}

export function RoleDashboardPage() {
  const navigate = useNavigate();
  const params = useParams();
  const roleParam = String(params.role || '').toUpperCase();
  const role = (Object.keys(ROLE_LABEL) as RoleName[]).includes(roleParam as RoleName)
    ? (roleParam as RoleName)
    : null;

  const panelHeight = useAvailablePanelHeight();
  const isDesktop = useIsDesktop();

  const [data, setData] = useState<RoleDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const backlogRef = useRef<HTMLDivElement | null>(null);
  const agingRef = useRef<HTMLDivElement | null>(null);
  const throughputRef = useRef<HTMLDivElement | null>(null);

  const [dashboardPickerOpen, setDashboardPickerOpen] = useState(false);

  const [clients, setClients] = useState<ClientDto[]>([]);

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toIsoDate(d);
  });
  const [to, setTo] = useState(() => toIsoDate(new Date()));
  const [bucket, setBucket] = useState<'DAY' | 'WEEK'>('DAY');
  const [clientId, setClientId] = useState<number | 'ALL'>('ALL');
  const [priority, setPriority] = useState<'ALL' | 'TRUE' | 'FALSE'>('ALL');
  const [selectedAgeDays, setSelectedAgeDays] = useState<number | 'ALL'>('ALL');

  useEffect(() => {
    http
      .get<ClientDto[]>('/admin/clients')
      .then((r) => setClients(r.data))
      .catch(() => setClients([]));
  }, []);

  const reload = async () => {
    if (!role) return;
    setLoading(true);
    setError(null);
    try {
      const r = await http.get<RoleDashboard>(`/admin/dashboard/role/${role}`, {
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
    const t = window.setTimeout(() => {
      reload();
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, from, to, bucket, clientId, priority]);

  const backlogBars = useMemo(() => {
    if (!data) return { rows: [], metric: 'count' as const, metricLabel: 'Bordereaux' };

    const rows = data.backlogByStatus
      .filter((x) => (x.count ?? 0) > 0 || (x.documents ?? 0) > 0)
      .map((x) => ({
        status: STATUS_LABEL[x.status] ?? x.status,
        count: x.count,
        documents: x.documents,
      }));

    const totalDocs = rows.reduce((s, r) => s + (r.documents || 0), 0);
    const metric = totalDocs > 0 ? ('documents' as const) : ('count' as const);
    const metricLabel = metric === 'documents' ? 'Documents' : 'Bordereaux';

    return { rows, metric, metricLabel };
  }, [data]);

  const agingDaily = useMemo(() => data?.agingDaily ?? [], [data]);
  const ageTickInterval = useMemo(() => {
    const n = agingDaily.length;
    return n > 24 ? Math.ceil(n / 12) : 0;
  }, [agingDaily]);

  const ageOptions = useMemo(() => {
    const set = new Set<number>();
    for (const r of agingDaily) set.add(r.ageDays);
    return Array.from(set).sort((a, b) => a - b);
  }, [agingDaily]);

  const waitingRows = useMemo(() => {
    const items = data?.waitingItems ?? [];
    if (selectedAgeDays === 'ALL') return items;
    return items.filter((x) => x.ageDays === selectedAgeDays);
  }, [data, selectedAgeDays]);

  const waitingExportColumns = useMemo(() => ([
    { header: 'Référence', value: (r: any) => r.reference },
    { header: 'Client', value: (r: any) => r.clientName ?? '' },
    { header: 'Statut', value: (r: any) => STATUS_LABEL[r.status] ?? r.status },
    { header: 'Document', value: (r: any) => r.documentType || '' },
    { header: 'Nombre', value: (r: any) => r.nombre ?? 0, align: 'right' as const },
    { header: 'Depuis', value: (r: any) => (r.statusSince ? new Date(r.statusSince).toLocaleString('fr-FR') : '') },
    { header: 'Attente (j)', value: (r: any) => r.ageDays, align: 'right' as const },
    { header: 'Lien', value: (r: any) => `/bordereaux/${r.bordereauId}` },
  ]), []);

  const waitingExportFilters = useMemo(() => {
    const scope = data?.scope;
    const clientLabel = !scope?.clientId ? 'Tous' : (clients.find((c) => c.id === scope.clientId)?.name ?? `Client #${scope.clientId}`);
    const prioLabel = scope?.priority == null ? 'Toutes' : scope.priority ? 'Prioritaires' : 'Non prioritaires';
    const ageLabel = selectedAgeDays === 'ALL' ? 'Tous' : `${selectedAgeDays} jour(s)`;
    return {
      Rôle: role,
      Période: scope ? `${scope.from} → ${scope.to}` : '—',
      Client: clientLabel,
      Priorité: prioLabel,
      Ancienneté: ageLabel,
      Total: waitingRows.length,
    };
  }, [data, clients, role, selectedAgeDays, waitingRows.length]);

  const exportPdf = async () => {
    if (!data) return;
    if (!backlogRef.current || !agingRef.current || !throughputRef.current) return;

    setExporting(true);
    setError(null);
    try {
      const [imgBacklog, imgAging, imgThroughput] = await Promise.all([
        captureElement(backlogRef.current),
        captureElement(agingRef.current),
        captureElement(throughputRef.current),
      ]);

      const logo = await loadImageAsDataUrl('/olea-logo.jpg');

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 44;
      const gap = 18;

      const OLEA_BROWN: [number, number, number] = [156, 61, 37];
      const OLEA_GOLD: [number, number, number] = [255, 184, 44];

      const scope = data.scope;
      const clientLabel =
        !scope.clientId ? 'Tous' : clients.find((c) => c.id === scope.clientId)?.name ?? `Client #${scope.clientId}`;
      const prioLabel = scope.priority == null ? 'Toutes' : scope.priority ? 'Prioritaires' : 'Non prioritaires';
      const bucketLabel = scope.bucket === 'DAY' ? 'Jour' : 'Semaine';
      // Normalize dates for PDF (remove any stray spacing) and avoid unicode arrows.
      const cleanFrom = String(scope.from ?? '').replace(/\s+/g, '').slice(0, 10);
      const cleanTo = String(scope.to ?? '').replace(/\s+/g, '').slice(0, 10);
      const period = `${cleanFrom} - ${cleanTo}`;
      const generatedAt = new Date().toLocaleString('fr-FR');

      const drawHeader = (pageTitle: string, pageSubtitle?: string) => {
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, W, 78, 'F');
        doc.setFillColor(...OLEA_BROWN);
        doc.rect(0, 0, W, 7, 'F');

        if (logo) {
          try {
            const fmt = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(logo, fmt as any, M, 18, 40, 40);
          } catch {}
        }

        const x = M + (logo ? 54 : 0);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(pageTitle, x, 42);

        if (pageSubtitle) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(71, 85, 105);
          doc.text(pageSubtitle, x, 60);
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        (doc as any).setCharSpace?.(0);
        doc.text(`Généré le ${generatedAt}`, W - M, 26, { align: 'right' });

        // Period (text only) — removed the yellow chip
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        (doc as any).setCharSpace?.(0);
        doc.text(`Période: ${period}`, W - M, 44, { align: 'right' });
      };

      const drawCard = (x: number, y: number, w: number, h: number, title: string) => {
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, y, w, h, 14, 14, 'FD');
        doc.setFillColor(...OLEA_BROWN);
        doc.roundedRect(x, y, w, 8, 14, 14, 'F');
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(title, x + 14, y + 28);
        return { ix: x + 10, iy: y + 36, iw: w - 20, ih: h - 46 };
      };

      // -----------------
      // COVER PAGE (clean)
      // -----------------
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, W, H, 'F');
      doc.setFillColor(...OLEA_BROWN);
      doc.rect(0, 0, W, 8, 'F');

      if (logo) {
        try {
          const fmt = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(logo, fmt as any, M, 18, 44, 44);
        } catch {}
      }

      const headerX = M + (logo ? 58 : 0);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(24);
      doc.text(`Rapport — Dashboard ${ROLE_LABEL[role]}`, headerX, 58);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      doc.text('Indicateurs & performance du rôle (backlog • ancienneté • throughput)', headerX, 78);

      // Meta (top-right)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      (doc as any).setCharSpace?.(0);
      doc.text(`Généré le ${generatedAt}`, W - M, 34, { align: 'right' });
      (doc as any).setCharSpace?.(0);
      doc.text(`Période: ${period}`, W - M, 50, { align: 'right' });

      doc.setDrawColor(226, 232, 240);
      doc.line(M, 92, W - M, 92);

      const drawSimpleTable = (opts: {
        title: string;
        x: number;
        y: number;
        w: number;
        leftHeader: string;
        rightHeader: string;
        rows: Array<[string, string]>;
      }) => {
        // Ensure no accidental character spacing leaks into table rendering
        ;(doc as any).setCharSpace?.(0);
        const rowH = 22;
        const headH = 24;
        const h = headH + opts.rows.length * rowH;

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(opts.title, opts.x, opts.y);

        const boxY = opts.y + 12;
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(opts.x, boxY, opts.w, h, 12, 12, 'FD');

        // Header row
        doc.setFillColor(248, 250, 252);
        doc.rect(opts.x, boxY, opts.w, headH, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        doc.text(opts.leftHeader, opts.x + 14, boxY + 16);
        doc.text(opts.rightHeader, opts.x + opts.w - 14, boxY + 16, { align: 'right' });

        // Rows
        for (let i = 0; i < opts.rows.length; i++) {
          const ry = boxY + headH + i * rowH;
          if (i % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(opts.x, ry, opts.w, rowH, 'F');
          }
          const [k, v] = opts.rows[i];
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(15, 23, 42);
          doc.text(k, opts.x + 14, ry + 15);
          doc.setFont('helvetica', 'bold');
          // If the value is long (e.g. a date range), shrink it slightly so it fits.
          const baseSize = 10;
          const maxValueW = opts.w - 210; // keep some room for the left column
          let fs = baseSize;
          doc.setFontSize(fs);
          while (fs > 8 && doc.getTextWidth(v) > maxValueW) {
            fs -= 1;
            doc.setFontSize(fs);
          }
          doc.text(v, opts.x + opts.w - 14, ry + 15, { align: 'right' });
          doc.setFontSize(baseSize);
        }

        return boxY + h;
      };

      // Périmètre / filtres
      const afterScope = drawSimpleTable({
        title: 'Périmètre',
        x: M,
        y: 122,
        w: W - 2 * M,
        leftHeader: 'Filtre',
        rightHeader: 'Valeur',
        rows: [
          ['Période', period],
          ['Client', clientLabel],
          ['Priorité', prioLabel],
          ['Bucket', bucketLabel],
        ],
      });

      // KPIs (rôle)
      const kpiRows: Array<[string, string]> = [
        ['Backlog (bordereaux)', String(data.kpis.backlogBordereaux)],
        ['Backlog (documents)', String(data.kpis.backlogDocuments)],
        ['Attente moy. (j)', String(data.kpis.avgWaitDays)],
        ['Plus ancien (j)', String(data.kpis.maxWaitDays)],
        ['Traités (période)', String(data.kpis.processedInRange)],
      ];

      drawSimpleTable({
        title: 'Indicateurs clés',
        x: M,
        y: afterScope + 26,
        w: W - 2 * M,
        leftHeader: 'Indicateur',
        rightHeader: 'Valeur',
        rows: kpiRows,
      });

      // -----------------
      // PAGE 2: 2 charts
      // -----------------
      doc.addPage();
      drawHeader(`DocuFlow — Rapport Dashboard ${ROLE_LABEL[role]}`, 'Backlog & ancienneté');
      const y = 98;
      const cardH = H - y - M;
      const cardW = (W - 2 * M - gap) / 2;

      const left = drawCard(M, y, cardW, cardH, 'Backlog par statut');
      addImageContained(doc, imgBacklog, 'PNG', left.ix, left.iy, left.iw, left.ih);

      const right = drawCard(M + cardW + gap, y, cardW, cardH, 'Ancienneté du backlog (jour par jour)');
      addImageContained(doc, imgAging, 'PNG', right.ix, right.iy, right.iw, right.ih);

      // -----------------
      // PAGE 3: chart + top oldest table
      // -----------------
      doc.addPage();
      drawHeader(`DocuFlow — Rapport Dashboard ${ROLE_LABEL[role]}`, 'Activité & top attente');

      const y3 = 98;
      const cardH3 = H - y3 - M;
      const cardW3 = (W - 2 * M - gap) / 2;

      const left3 = drawCard(M, y3, cardW3, cardH3, 'Activité du rôle');
      addImageContained(doc, imgThroughput, 'PNG', left3.ix, left3.iy, left3.iw, left3.ih);

      // Right side: Top oldest waiting items
      const right3 = drawCard(M + cardW3 + gap, y3, cardW3, cardH3, 'Top 12 plus anciens (aperçu)');

      const topOldest = waitingRows
        .slice()
        .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
        .slice(0, 12);

      autoTable(doc as any, {
        startY: right3.iy,
        margin: { left: right3.ix, right: W - (right3.ix + right3.iw) },
        tableWidth: right3.iw,
        head: [['Référence', 'Document', 'Attente (j)']],
        body: topOldest.map((r) => [r.reference, r.documentType ?? '', String(r.ageDays ?? 0)]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [15, 23, 42] },
        headStyles: { fillColor: OLEA_BROWN as any, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        theme: 'grid',
      } as any);

      // -----------------
      // PAGE 4: backlog details preview (optional)
      // -----------------
      const preview = waitingRows.slice(0, 40);
      if (preview.length) {
        doc.addPage();
        drawHeader(`DocuFlow — Rapport Dashboard ${ROLE_LABEL[role]}`, 'Détails du backlog (aperçu)');

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(`Aperçu: ${preview.length} / ${waitingRows.length} ligne(s)`, M, 104);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        doc.text('Pour exporter la liste complète: utilisez le bouton PDF/Excel dans la section “Détails du backlog”.', M, 122);

        autoTable(doc as any, {
          startY: 140,
          margin: { left: M, right: M },
          head: [[
            'Référence',
            'Client',
            'Statut',
            'Document',
            'Nombre',
            'Depuis',
            'Attente (j)',
          ]],
          body: preview.map((r) => [
            r.reference,
            r.clientName ?? '',
            STATUS_LABEL[r.status] ?? r.status,
            r.documentType ?? '',
            String(r.nombre ?? 0),
            r.statusSince ? new Date(r.statusSince).toLocaleString('fr-FR') : '',
            String(r.ageDays ?? 0),
          ]),
          styles: {
            font: 'helvetica',
            fontSize: 9,
            textColor: [15, 23, 42],
            cellPadding: 6,
            overflow: 'linebreak',
          },
          headStyles: {
            fillColor: OLEA_BROWN as any,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          theme: 'grid',
          columnStyles: {
            4: { halign: 'right' },
            6: { halign: 'right' },
          },
        } as any);
      }

      // Footer: page numbers
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${i} / ${totalPages}`, W / 2, H - 18, { align: 'center' });
        doc.setTextColor(203, 213, 225);
        doc.text('OLEA', W - M, H - 18, { align: 'right' });
      }

      doc.save(`rapport-dashboard-${role}-${cleanFrom}_to_${cleanTo}.pdf`);
    } catch (e: any) {
      setError(e?.message ?? 'Export PDF impossible');
    } finally {
      setExporting(false);
    }
  };

  if (!role) {
    return (
      <div className="card p-4">
        <div className="text-sm font-bold text-slate-900">Dashboard rôle</div>
        <div className="muted mt-1 text-sm">Rôle invalide.</div>
        <button className="btn mt-3" onClick={() => navigate('/admin/dashboard')}>
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className={isDesktop ? "overflow-hidden" : "overflow-auto"} style={panelHeight ? { height: panelHeight } : undefined}>
      <Modal
        title="Choisir un dashboard"
        open={dashboardPickerOpen}
        onClose={() => setDashboardPickerOpen(false)}
        width={520}
      >
        <div className="grid gap-2">
          <button
            className="btn w-full"
            onClick={() => {
              setDashboardPickerOpen(false);
              navigate('/admin/dashboard');
            }}
          >
            <div className="flex w-full items-center justify-between">
              <span>Vue globale</span>
              <span className="text-slate-400">→</span>
            </div>
          </button>

          <div className="my-2 h-px bg-slate-200/70" />

          {ROLE_DASHBOARDS.map((r) => (
            <button
              key={r.role}
              className="btn w-full"
              onClick={() => {
                setDashboardPickerOpen(false);
                navigate(`/admin/dashboard/role/${r.role}`);
              }}
            >
              <div className="flex w-full items-center justify-between">
                <span>{r.label}</span>
                <span className="text-slate-400">→</span>
              </div>
            </button>
          ))}
        </div>
      </Modal>
      <div className="flex h-full flex-col gap-3">
        <div className="card shrink-0 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900">Dashboard — {ROLE_LABEL[role]}</div>
              <div className="muted text-xs">
                Indicateurs &amp; performance du rôle • backlog (attente) + ancienneté + throughput
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button className="btn" type="button" onClick={() => setDashboardPickerOpen(true)}
              >
                Dashboards
              </button>
              <button className="btn" onClick={() => navigate('/admin/dashboard')}>
                Vue globale
              </button>
              <button className="btn" onClick={reload} disabled={loading || exporting}>
                {loading ? '…' : 'Recharger'}
              </button>
              <button className="btn primary" onClick={exportPdf} disabled={loading || exporting || !data}>
                {exporting ? 'Export…' : 'PDF'}
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-5">
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

          {error ? <div className="mt-2 badge danger">{error}</div> : null}

          {data ? (
            <div className="mt-3 grid gap-2 md:grid-cols-5">
              <MiniKpi label="Backlog (bordereaux)" value={data.kpis.backlogBordereaux} />
              <MiniKpi label="Backlog (documents)" value={data.kpis.backlogDocuments} />
              <MiniKpi label="Attente moy. (jours)" value={data.kpis.avgWaitDays} />
              <MiniKpi label="Plus ancien (jours)" value={data.kpis.maxWaitDays} />
              <MiniKpi label="Traités (période)" value={data.kpis.processedInRange} />
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 auto-rows-[280px] lg:flex-1 lg:min-h-0 lg:grid-cols-3 lg:grid-rows-2 lg:auto-rows-fr">
          <ChartCard
            title="Backlog par statut"
            chartRef={backlogRef}
            subtitle={
              role === 'SCANNER'
                ? `Nombre de ${backlogBars.metricLabel.toLowerCase()} en attente d'être scannés`
                : `Nombre de ${backlogBars.metricLabel.toLowerCase()} en attente par étape du rôle`
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={backlogBars.rows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} interval={0} angle={-10} height={44} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey={backlogBars.metric} fill={CHART_COLORS[0]} radius={[10,10,10,10]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Ancienneté du backlog (jour par jour)"
            chartRef={agingRef}
            subtitle={
              role === 'SCANNER'
                ? "Nombre de documents en attente selon l'ancienneté (clic pour voir le détail)"
                : "Répartition jour par jour de l'ancienneté du backlog (clic pour voir le détail)"
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingDaily} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ageDays" tick={{ fontSize: 11 }} interval={ageTickInterval} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any) => [value, backlogBars.metricLabel]}
                  labelFormatter={(label: any) => `${label} jour(s)`}
                />
                <Bar
                  dataKey={backlogBars.metric}
                  fill={CHART_COLORS[1]}
                  radius={[10,10,10,10]}
                  onClick={(d: any) => {
                    const age = d?.payload?.ageDays;
                    if (typeof age === 'number') setSelectedAgeDays(age);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Activité du rôle" chartRef={throughputRef} subtitle="Transitions effectuées (historique) sur la période sélectionnée">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.throughputSeries ?? []} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={CHART_COLORS[2]}
                  fill={CHART_COLORS[2]}
                  fillOpacity={0.18}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="card lg:col-span-3 flex min-h-0 flex-col p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-black text-slate-900">
                  Détails du backlog{selectedAgeDays === 'ALL' ? '' : ` · ${selectedAgeDays} jour(s)`}
                </div>
                <div className="muted mt-0.5 truncate text-[10px]">Documents/bordereaux en attente — lien direct vers le bordereau</div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600">Ancienneté</span>
                <select
                  className="input h-9"
                  value={selectedAgeDays}
                  onChange={(e) => setSelectedAgeDays(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                >
                  <option value="ALL">Tous</option>
                  {ageOptions.map((d) => (
                    <option key={d} value={d}>
                      {d} jour(s)
                    </option>
                  ))}
                </select>


                <ExportButtons
                  title={`Backlog — ${role}`}
                  filenameBase={`backlog_details_${role}`}
                  columns={waitingExportColumns}
                  rows={waitingRows}
                  filters={waitingExportFilters}
                  disabled={loading}
                  orientation="landscape"
                />
              </div>
            </div>

            <div className="mt-2 flex-1 min-h-0 overflow-auto rounded-2xl bg-white ring-1 ring-slate-200/60">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Référence</th>
                    <th className="px-3 py-2">Client</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2">Document</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Depuis</th>
                    <th className="px-3 py-2">Attente</th>
                  </tr>
                </thead>
                <tbody>
                  {waitingRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        Aucun élément.
                      </td>
                    </tr>
                  ) : (
                    waitingRows.map((r, idx) => (
                      <tr key={`${r.bordereauId}-${idx}`} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <button className="text-blue-700 hover:underline" onClick={() => navigate(`/bordereaux/${r.bordereauId}`)}>
                            {r.reference}
                          </button>
                        </td>
                        <td className="px-3 py-2">{r.clientName ?? '-'}</td>
                        <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                        <td className="px-3 py-2">{r.documentType || '-'}</td>
                        <td className="px-3 py-2">{r.nombre ?? 0}</td>
                        <td className="px-3 py-2">{r.statusSince ? new Date(r.statusSince).toLocaleString() : '-'}</td>
                        <td className="px-3 py-2">{r.ageDays} j</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
