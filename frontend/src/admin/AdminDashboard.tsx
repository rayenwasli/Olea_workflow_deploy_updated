import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import { Modal } from '../components/Modal';

import { http } from '../api/http';
import type { ClientDto, DashboardOverview, BordereauStatus } from '../types';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
  LabelList,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';

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

const WORKFLOW: BordereauStatus[] = ['CREE','RECUPERE_BO','DEPOSE_SCAN','SCANNE','VERIFIE','PRET_A_ENVOYER','RECU_DU_RESPONSABLE','DONNE_AU_COURSIER','FINALISE'];

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

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const calc = () => {
      const next = window.matchMedia('(min-width: 1024px)').matches;
      setIsDesktop(next);
    };
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

      // Fit exactly in the viewport (no scroll). Keep a tiny floor so Recharts never gets 0px height.
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

function formatCompact(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  if (v >= 1_000_000) return `${Math.round(v / 100_000) / 10}M`;
  if (v >= 1_000) return `${Math.round(v / 100) / 10}k`;
  return String(v);
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
  right,
  chartRef,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  chartRef?: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex min-h-0 flex-col p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black text-slate-900">{title}</div>
          {subtitle ? <div className="muted mt-0.5 truncate text-[10px]">{subtitle}</div> : null}
        </div>
        {right}
      </div>

      {/* IMPORTANT for "no scroll": flex-1 + min-h-0 so chart can shrink inside the grid */}
      <div
        ref={chartRef as any}
        className="mt-2 flex-1 min-h-0 rounded-2xl bg-white p-1.5 ring-1 ring-slate-200/60"
      >
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


export function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dashboardPickerOpen, setDashboardPickerOpen] = useState(false);

  const panelHeight = useAvailablePanelHeight();
  const isDesktop = useIsDesktop();

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

  // Export refs (keep PDF export working)
  const statusRef = useRef<HTMLDivElement | null>(null);
  const funnelRef = useRef<HTMLDivElement | null>(null);
  const createdVsFinalRef = useRef<HTMLDivElement | null>(null);
  const avgTimeRef = useRef<HTMLDivElement | null>(null);
  const agingRef = useRef<HTMLDivElement | null>(null);
  const roleActivityRef = useRef<HTMLDivElement | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await http.get<DashboardOverview>(`/admin/dashboard/overview`, {
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
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh when filters change (fixes “graphs not updating” without requiring a manual click)
  useEffect(() => {
    const t = window.setTimeout(() => {
      reload();
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, bucket, clientId, priority]);

  useEffect(() => {
    http
      .get<ClientDto[]>('/admin/clients')
      .then((r) => setClients(r.data))
      .catch(() => setClients([]));
  }, []);

  const createdVsFinal = useMemo(() => {
    if (!data) return [];
    return (data.createdSeries ?? []).map((p) => ({ bucket: p.bucket, created: Number(p.count ?? 0) }));
  }, [data]);

  const hasCreatedVsFinal = useMemo(() => {
    return createdVsFinal.some((r) => Number(r.created ?? 0) > 0);
  }, [createdVsFinal]);
  const funnelOrdered = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, number>();
    for (const it of data.funnel || []) m.set(it.status, Number((it as any).count ?? 0));
    return WORKFLOW.map((s) => ({
      status: s,
      label: STATUS_LABEL[s],
      count: m.get(s) ?? 0,
    }));
  }, [data]);

  const roleActivity = useMemo(() => {
    if (!data) return [];
    // Ensure numeric values (defensive against backend returning strings)
    return data.roleActivitySeries.map((p) => {
      const out: any = { bucket: p.bucket };
      for (const [k, v] of Object.entries(p.countsByRole || {})) out[k] = Number(v ?? 0);
      return out;
    });
  }, [data]);

  const hasRoleActivity = useMemo(() => {
    if (!roleActivity.length) return false;
    let total = 0;
    for (const row of roleActivity) {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'bucket') continue;
        total += Number(v ?? 0);
      }
    }
    return total > 0;
  }, [roleActivity]);

  const statusPie = useMemo(() => {
    if (!data) return [] as { name: string; value: number }[];
    return (data.statusCounts ?? [])
      .filter((s) => s.status !== 'VALIDE')
      .map((s) => ({
        name: STATUS_LABEL[s.status as BordereauStatus] ?? String(s.status),
        value: Number(s.count ?? 0),
      }))
      .filter((x) => x.value > 0);
  }, [data]);

  const showStatusLegend = statusPie.length > 0 && statusPie.length <= 8;

  const avgTimeRadar = useMemo(() => {
    if (!data) return [] as { status: BordereauStatus | 'N/A'; avgHours: number; samples: number }[];
    return (data.avgTimePerStatus ?? [])
      .filter((x) => x.status !== 'VALIDE')
      .map((x) => ({
        status: (x.status as BordereauStatus) ?? 'N/A',
        avgHours: Number(x.avgHours ?? 0),
        samples: Number((x as any).samples ?? 0),
      }));
  }, [data]);

  const bottleneck = useMemo(() => {
    let best: { status: BordereauStatus | 'N/A'; avgHours: number; samples: number } = { status: 'N/A', avgHours: 0, samples: 0 };
    for (const r of avgTimeRadar) {
      if (Number(r.samples ?? 0) <= 0) continue;
      if (Number(r.avgHours ?? 0) > Number(best.avgHours ?? 0)) best = r as any;
    }
    return best;
  }, [avgTimeRadar]);

  const agingChartData = useMemo(() => {
    if (!data) return [] as any[];
    return (data.agingBuckets ?? []).map((b) => ({ bucket: b.bucket, ...(b.byStatus ?? {}) }));
  }, [data]);

  const topAgingStatusKeys = useMemo(() => {
    if (!agingChartData.length) return [] as string[];
    const totals = new Map<string, number>();
    for (const row of agingChartData) {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'bucket') continue;
        totals.set(k, (totals.get(k) ?? 0) + Number(v ?? 0));
      }
    }
    return Array.from(totals.entries())
      .filter(([k]) => k !== 'VALIDE')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
  }, [agingChartData]);

  const agingCompact = useMemo(() => {
    if (!agingChartData.length) return [] as any[];
    const keys = topAgingStatusKeys;
    return agingChartData.map((row) => {
      const out: any = { bucket: row.bucket };
      let other = 0;
      for (const [k, v] of Object.entries(row)) {
        if (k === 'bucket') continue;
        const n = Number(v ?? 0);
        if (keys.includes(k)) out[k] = n;
        else other += n;
      }
      out.AUTRES = other;
      return out;
    });
  }, [agingChartData, topAgingStatusKeys]);

  // Keep a fixed business-role order so Responsable client and Responsable client prod
  // are always displayed separately in the global dashboard.
  const topRoleKeys = useMemo(() => {
    if (!roleActivity.length) return [] as string[];
    const available = new Set<string>();
    for (const row of roleActivity) {
      for (const key of Object.keys(row)) {
        if (key !== 'bucket') available.add(key);
      }
    }
    return ROLE_DASHBOARDS.map((r) => r.role).filter((role) => available.has(role));
  }, [roleActivity]);

  const exportPdf = async () => {
    if (!data) return;
    if (
      !statusRef.current ||
      !funnelRef.current ||
      !createdVsFinalRef.current ||
      !avgTimeRef.current ||
      !agingRef.current ||
      !roleActivityRef.current
    )
      return;

    setExporting(true);
    setError(null);
    try {
      const [imgStatus, imgFunnel, imgCreated, imgAvg, imgAging, imgRole] = await Promise.all([
        captureElement(statusRef.current),
        captureElement(funnelRef.current),
        captureElement(createdVsFinalRef.current),
        captureElement(avgTimeRef.current),
        captureElement(agingRef.current),
        captureElement(roleActivityRef.current),
      ]);

      const logo = await loadImageAsDataUrl('/olea-logo.jpg');

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 44;
      const gap = 18;
      const OLEA_BROWN: [number, number, number] = [156, 61, 37];
      const OLEA_GOLD: [number, number, number] = [255, 184, 44];

      const generatedAt = new Date().toLocaleString('fr-FR');
      // jsPDF base fonts don't reliably support unicode arrows, and sometimes
      // period strings arrive with unexpected spacing (e.g. "2 0 2 6-...").
      // Normalize aggressively so the PDF shows a clean, compact date range.
      const cleanFrom = String(from ?? '').replace(/\s+/g, '');
      const cleanTo = String(to ?? '').replace(/\s+/g, '');
      const period = `${cleanFrom} - ${cleanTo}`;

      const clientLabel =
        clientId === 'ALL'
          ? 'Tous les clients'
          : clients.find((c) => c.id === clientId)?.name ?? `Client #${clientId}`;
      const priorityLabel =
        priority === 'ALL' ? 'Toutes priorités' : priority === 'TRUE' ? 'Prioritaires' : 'Non prioritaires';
      const bucketLabel = bucket === 'DAY' ? 'Jour' : 'Semaine';

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
        // small accent line
        doc.setFillColor(...OLEA_BROWN);
        doc.roundedRect(x, y, w, 8, 14, 14, 'F');
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(title, x + 14, y + 28);
        return { ix: x + 10, iy: y + 36, iw: w - 20, ih: h - 46 };
      };

      const twoChartsPage = (opts: {
        section: string;
        leftTitle: string;
        leftImg: Captured;
        rightTitle: string;
        rightImg: Captured;
      }) => {
        doc.addPage();
        drawHeader('DocuFlow — Rapport Dashboard (Vue globale)', opts.section);

        const y = 98;
        const cardH = H - y - M;
        const cardW = (W - 2 * M - gap) / 2;

        const left = drawCard(M, y, cardW, cardH, opts.leftTitle);
        addImageContained(doc, opts.leftImg, 'PNG', left.ix, left.iy, left.iw, left.ih);

        const right = drawCard(M + cardW + gap, y, cardW, cardH, opts.rightTitle);
        addImageContained(doc, opts.rightImg, 'PNG', right.ix, right.iy, right.iw, right.ih);
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
      doc.text('Rapport — Dashboard (Vue globale)', headerX, 58);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      doc.text('Synthèse opérationnelle (statuts • volumes • temps)', headerX, 78);

      // Meta (top-right)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.text(`Généré le ${generatedAt}`, W - M, 34, { align: 'right' });
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
          ['Priorité', priorityLabel],
          ['Bucket', bucketLabel],
        ],
      });

      // KPIs
      const kpiRows: Array<[string, string]> = [
        ['Total bordereaux', String(data.kpis.totalBordereaux)],
        ['Backlog', String(data.kpis.backlog)],
        ['Prioritaires', String(data.kpis.priorityCount)],
        ['En cours (24h)', String(data.kpis.inProgressToday)],
        ['En cours (7j)', String(data.kpis.inProgressWeek)],
        ['Cycle moyen (h)', data.kpis.avgCycleHours == null ? '—' : String(data.kpis.avgCycleHours)],
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

      // Note
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.text(
        'Ce rapport reprend les indicateurs affichés sur le dashboard. Les graphiques sont fournis en pages suivantes.',
        M,
        H - 34
      );

      // -----------------
      // CHART PAGES
      // -----------------
      twoChartsPage({
        section: 'Flux par statut',
        leftTitle: 'Répartition par statut',
        leftImg: imgStatus,
        rightTitle: 'Funnel par statut',
        rightImg: imgFunnel,
      });

      twoChartsPage({
        section: 'Volumes (période)',
        leftTitle: 'Volumes créés',
        leftImg: imgCreated,
        rightTitle: 'Activité par rôle',
        rightImg: imgRole,
      });

      twoChartsPage({
        section: 'Temps & vieillissement',
        leftTitle: 'Temps moyen par statut',
        leftImg: imgAvg,
        rightTitle: 'Backlog (aging)',
        rightImg: imgAging,
      });

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

      doc.save(`rapport-dashboard-global-${cleanFrom}_to_${cleanTo}.pdf`);
    } catch (e: any) {
      setError(e?.message ?? 'Export PDF impossible');
    } finally {
      setExporting(false);
    }
  };

  /**
   * NO-SCROLL LAYOUT NOTES:
   * - Root: h-screen + overflow-hidden
   * - Content zone: flex-1 + min-h-0
   * - Chart cards: min-h-0 + internal chart area: flex-1 min-h-0 + ResponsiveContainer height="100%"
   *
   * If you have a navbar, replace h-screen with: h-[calc(100vh-64px)] (or your header height)
   */
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
        {/* Compact top bar: title + filters + KPIs (minimized) */}
        <div className="card shrink-0 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900">Dashboard</div>
              <div className="muted text-xs">Vue synthèse — charte OLEA • sans scroll</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="btn"
                type="button"
                onClick={() => setDashboardPickerOpen(true)}
                disabled={loading || exporting}
              >
                Dashboards
              </button>


              <button className="btn" onClick={reload} disabled={loading || exporting}>
                {loading ? '…' : 'Recharger'}
              </button>
              <button className="btn primary" onClick={exportPdf} disabled={loading || exporting || !data}>
                {exporting ? 'Export…' : 'PDF'}
              </button>
            </div>
          </div>

          {/* Minimized filters (single compact row) */}
          <div className="mt-3 grid gap-2 md:grid-cols-5">
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200/60">
              <span className="text-[11px] font-bold text-slate-600">Du</span>
              <input
                className="input h-9 flex-1"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
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

          {/* Minimized KPIs (small, dense strip) */}
          {data ? (
            <div className="mt-3 grid gap-2 md:grid-cols-6">
              <MiniKpi label="Total" value={data.kpis.totalBordereaux} />
              <MiniKpi label="Backlog" value={data.kpis.backlog} />
              <MiniKpi label="Prioritaires" value={data.kpis.priorityCount} />
              <MiniKpi label="En cours 24h" value={data.kpis.inProgressToday} />
              <MiniKpi label="En cours 7j" value={data.kpis.inProgressWeek} />
              <MiniKpi label="Cycle (h)" value={data.kpis.avgCycleHours ?? '—'} />
            </div>
          ) : null}
        </div>

        {/* Charts area (takes remaining height, 6 charts, no scroll) */}
        <div className="flex-1 min-h-0">
          {data ? (
            <div className="grid gap-3 grid-cols-1 auto-rows-[280px] sm:grid-cols-2 xl:grid-cols-3 lg:h-full lg:min-h-0 lg:auto-rows-fr lg:grid-rows-3 xl:grid-rows-2">
              {/* Status distribution */}
              <ChartCard title="Répartition par statut" subtitle="Donut (statut courant)" chartRef={statusRef}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip formatter={(v: any) => formatCompact(v)} />
                    {showStatusLegend ? <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 10 }} /> : null}
                    <Pie
                      data={statusPie.length ? statusPie : [{ name: '—', value: 1 }]}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="45%"
                      innerRadius="55%"
                      outerRadius="80%"
                      paddingAngle={2}
                      stroke="rgba(15,23,42,0.06)"
                    >
                      {(statusPie.length ? statusPie : [{ name: '—', value: 1 }]).map((_, idx) => (
                        <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Funnel */}
              <ChartCard
                title="Funnel par statut"
                subtitle="Distribution (statut courant)"
                chartRef={funnelRef}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelOrdered} layout="vertical" margin={{ left: 10, right: 18, top: 6, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickFormatter={formatCompact}
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={140}
                      interval={0}
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v: any) => formatCompact(v)}
                      labelFormatter={(_label: any, payload: any) => {
                        const p = payload?.[0]?.payload;
                        return p?.label ?? '';
                      }}
                    />
                    <Bar dataKey="count" fill={CHART_COLORS[0]} radius={[10, 10, 10, 10]}>
                      <LabelList dataKey="count" position="right" formatter={(v: any) => (Number(v) > 0 ? formatCompact(v) : "")} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Created vs Finalized */}
              <ChartCard
                title="Volumes créés"
                subtitle={`Évolution (${bucket === 'DAY' ? 'jour' : 'semaine'})`}
                chartRef={createdVsFinalRef}
              >
                {hasCreatedVsFinal ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={createdVsFinal} margin={{ left: 10, right: 10, top: 6, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tickFormatter={formatCompact}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, (max: number) => Math.max(1, max)]}
                      />
                      <Tooltip formatter={(v: any) => formatCompact(v)} />
                      <Area
                        type="monotone"
                        dataKey="created"
                        stroke={CHART_COLORS[2]}
                        fill={CHART_COLORS[2]}
                        fillOpacity={0.18}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    Aucune donnée sur la période
                  </div>
                )}
              </ChartCard>

              {/* Avg time (radar) */}
              <ChartCard
                title="Temps moyen par statut"
                subtitle={
                  bottleneck.status === 'N/A'
                    ? 'Aucune donnée sur la période'
                    : `Bottleneck: ${STATUS_LABEL[bottleneck.status as BordereauStatus] ?? String(bottleneck.status)} (${bottleneck.avgHours}h)`
                }
                chartRef={avgTimeRef}
                right={
                  bottleneck.status === 'N/A' ? null : (
                    <span className="badge" style={{ background: '#fff7ed', color: '#9c3d25' }}>
                      {bottleneck.samples} échant.
                    </span>
                  )
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={avgTimeRadar} outerRadius="78%">
                    <PolarGrid />
                    <PolarAngleAxis
                      dataKey="status"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(s: any) => STATUS_LABEL[s as BordereauStatus] ?? String(s)}
                    />
                    <PolarRadiusAxis tick={{ fontSize: 10 }} tickFormatter={formatCompact} />
                    <Tooltip formatter={(v: any) => formatCompact(v)} />
                    <Radar
                      name="Heures"
                      dataKey="avgHours"
                      stroke={CHART_COLORS[0]}
                      fill={CHART_COLORS[0]}
                      fillOpacity={0.18}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Aging / backlog */}
              <ChartCard title="Backlog (aging)" subtitle="0-2j / 3-7j / 8-14j / 15+ (stacked)" chartRef={agingRef}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingCompact} margin={{ left: 10, right: 10, top: 6, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: any) => formatCompact(v)} />
                    {topAgingStatusKeys.map((k, idx) => (
                      <Bar
                        key={k}
                        dataKey={k}
                        stackId="a"
                        fill={CHART_COLORS[idx % CHART_COLORS.length]}
                      />
                    ))}
                    <Bar dataKey="AUTRES" stackId="a" fill="#94a3b8" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Role activity (stacked area) */}
              <ChartCard
                title="Activité par rôle"
                subtitle={`Transitions sur la période par rôle (stacked)`}
                chartRef={roleActivityRef}
              >
                {hasRoleActivity ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={roleActivity} margin={{ left: 10, right: 10, top: 6, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tickFormatter={formatCompact}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, (max: number) => Math.max(1, max)]}
                      />
                      <Tooltip formatter={(v: any) => formatCompact(v)} />
                      {topRoleKeys.map((k, idx) => (
                        <Area
                          key={k}
                          type="monotone"
                          dataKey={k}
                          stackId="1"
                          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                          fill={CHART_COLORS[idx % CHART_COLORS.length]}
                          fillOpacity={0.14}
                          strokeWidth={1.8}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    Aucune transition sur la période
                  </div>
                )}
              </ChartCard>
            </div>
          ) : (
            <div className="card h-full p-5">
              <div className="muted">{loading ? 'Chargement…' : '—'}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}