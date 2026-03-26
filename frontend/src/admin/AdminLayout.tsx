import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

function SideItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold transition',
          'text-white/90 hover:bg-white/10',
          isActive ? 'bg-white/15 text-white ring-1 ring-white/20' : '',
        ].join(' ')
      }
      end
    >
      <span>{label}</span>
      <svg viewBox="0 0 24 24" className="h-4 w-4 opacity-80" fill="none" aria-hidden="true">
        <path
          d="M8 5l8 7-8 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </NavLink>
  );
}

function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="card overflow-hidden">
      <div className="bg-gradient-to-b from-olea-800 to-olea-700 p-5 text-white">
        <div className="text-xs font-semibold text-white/80">Espace</div>
        <div className="mt-1 text-xl font-black tracking-tight">Administration</div>
        <div className="mt-2 text-xs text-white/75">Gestion des utilisateurs, clients et affectations.</div>
      </div>

      <nav className="space-y-2 bg-gradient-to-b from-olea-800 to-olea-700 p-4">
        <SideItem to="/admin/dashboard" label="Dashboard" onClick={onNavigate} />
        <SideItem to="/admin/numeric-stats" label="Statistique numérique" onClick={onNavigate} />
        <SideItem to="/admin/users" label="Utilisateurs" onClick={onNavigate} />
        <SideItem to="/admin/document-types" label="Types documents" onClick={onNavigate} />
        <SideItem to="/admin/clients" label="Clients" onClick={onNavigate} />
        <SideItem to="/admin/assureurs" label="Assureurs" onClick={onNavigate} />
        <SideItem to="/admin/affectations" label="Affectations" onClick={onNavigate} />
        <SideItem to="/admin/bordereaux" label="Bordereaux" onClick={onNavigate} />
        <SideItem to="/admin/alerts" label="Alertes" onClick={onNavigate} />
        <SideItem to="/admin/undo-requests" label="Undo requests" onClick={onNavigate} />
      </nav>
    </aside>
  );
}

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close drawer on route change (defensive)
  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="relative">
      {/* Mobile admin header */}
      <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
        <div className="min-w-0">
          <div className="text-lg font-black tracking-tight text-slate-900">Administration</div>
          <div className="muted text-xs">Gestion (admin)</div>
        </div>
        <button className="btn" onClick={() => setMobileOpen(true)}>
          Menu
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onMouseDown={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-sm p-3" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-end pb-2">
              <button className="btn" onClick={() => setMobileOpen(false)} aria-label="Fermer">
                ✕
              </button>
            </div>
            <AdminSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Desktop sidebar */}
        <div className="hidden lg:block lg:col-span-3">
          <AdminSidebar />
        </div>

        {/* Content */}
        <section className="lg:col-span-9">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
