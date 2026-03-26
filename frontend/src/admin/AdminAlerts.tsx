import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { http } from '../api/http';
import { ExportButtons } from '../components/ExportButtons';

type AlertItem = {
  bordereauId: number;
  reference: string;
  clientId: number | null;
  clientName: string | null;
  priority: boolean;
  enteredAt: string | null;
  ageHours: number;
};

type ApiRes = {
  thresholdHours: number;
  items: AlertItem[];
};

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function AdminAlerts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thresholdHours, setThresholdHours] = useState(48);
  const [items, setItems] = useState<AlertItem[]>([]);

  const total = items.length;
  const priorityCount = useMemo(() => items.filter((x) => x.priority).length, [items]);

  const exportColumns = useMemo(() => ([
    { header: 'Référence', value: (x: AlertItem) => x.reference },
    { header: 'Client', value: (x: AlertItem) => x.clientName || (x.clientId != null ? `Client #${x.clientId}` : '—') },
    { header: 'Depuis', value: (x: AlertItem) => fmtDateTime(x.enteredAt) },
    { header: 'Durée (h)', value: (x: AlertItem) => x.ageHours, align: 'right' as const },
    { header: 'Priorité', value: (x: AlertItem) => (x.priority ? 'Oui' : 'Non') },
  ]), [items]);

  const exportFilters = useMemo(() => ({
    Seuil: `${thresholdHours}h`,
    Total: total,
    Prioritaires: priorityCount,
  }), [thresholdHours, total, priorityCount]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await http.get<ApiRes>('/admin/alerts/bordereaux-bloques');
      setThresholdHours(Number(res.data.thresholdHours || 48));
      setItems(Array.isArray(res.data.items) ? res.data.items : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight">Alertes · Bordereaux bloqués</h2>
          <p className="mt-1 text-sm text-slate-600">
            Bordereaux restés dans l’état <span className="font-semibold">“Donné au coursier”</span> pendant plus de{' '}
            <span className="font-semibold">{thresholdHours}h</span>.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">Total: {total}</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">Prioritaires: {priorityCount}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? 'Chargement…' : 'Rafraîchir'}
          </button>


          <ExportButtons
            title="Alertes — Bordereaux bloqués"
            filenameBase="alertes_bordereaux_bloques"
            columns={exportColumns}
            rows={items}
            filters={exportFilters}
            disabled={loading}
            orientation="landscape"
          />
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="mt-5 overflow-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b text-slate-500">
              <th className="px-3 py-2 font-semibold">Référence</th>
              <th className="px-3 py-2 font-semibold">Client</th>
              <th className="px-3 py-2 font-semibold">Depuis</th>
              <th className="px-3 py-2 font-semibold">Durée</th>
              <th className="px-3 py-2 font-semibold">Priorité</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                  {loading ? 'Chargement…' : 'Aucune alerte pour le moment.'}
                </td>
              </tr>
            ) : (
              items.map((x) => (
                <tr key={x.bordereauId} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-semibold">{x.reference}</td>
                  <td className="px-3 py-2">{x.clientName || (x.clientId != null ? `Client #${x.clientId}` : '—')}</td>
                  <td className="px-3 py-2">{fmtDateTime(x.enteredAt)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">{x.ageHours}h</span>
                  </td>
                  <td className="px-3 py-2">
                    {x.priority ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">Oui</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">Non</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/bordereaux/${x.bordereauId}`} className="btn px-3 py-1.5 text-xs">
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
