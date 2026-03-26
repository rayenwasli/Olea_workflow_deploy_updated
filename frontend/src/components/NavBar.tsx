import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NotificationBell } from '../notifications/NotificationBell';
import logoUrl from '../../olea-logo.jpg';

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'inline-flex items-center rounded-2xl px-3 py-2 text-sm font-semibold transition',
          'text-slate-700 hover:bg-white/70 hover:text-slate-900',
          isActive ? 'bg-white/80 text-slate-900 shadow-sm ring-1 ring-slate-200/70' : '',
        ].join(' ')
      }
    >
      {label}
    </NavLink>
  );
}

export function NavBar() {
  const auth = useAuth();
  const nav = useNavigate();

  const logout = () => {
    auth.logout();
    nav('/login');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/70 backdrop-blur">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 2xl:px-12">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="group flex items-center gap-3" aria-label="Accueil">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70 ring-1 ring-slate-200/70 shadow-sm">
              <img src={logoUrl} alt="OLEA" className="h-6 w-8 object-contain" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black tracking-tight text-slate-900">
                DocuFlow
                <span className="ml-2 text-xs font-semibold text-slate-500">#BeAFRICA ChooseOLEA</span>
              </div>
              <div className="text-xs text-slate-500">Plateforme de gestion des bordereaux</div>
            </div>
          </Link>

          {auth.token ? (
            <nav className="ml-2 hidden flex-wrap items-center gap-1 lg:flex">
              {auth.hasRole('BUREAU_ORDRE') && <NavItem to="/bureau-ordre" label="Bureau d’ordre" />}
              {auth.hasRole('COORDINATEUR') && <NavItem to="/coordinateur" label="Coordinateur" />}
              {auth.hasRole('SCANNER') && <NavItem to="/scanner" label="Scanner" />}
              {auth.hasRole('VERIFICATEUR') && <NavItem to="/verificateur" label="Vérificateur" />}
              {(auth.hasRole('RESPONSABLE_CLIENT') || auth.hasRole('RESPONSABLE_CLIENT_PROD')) && <NavItem to="/responsable-client" label="Responsable client" />}
              {auth.hasRole('COURSIER') && <NavItem to="/coursier" label="Coursier" />}
              <NavItem to="/chat" label="Chat" />
              {auth.hasRole('ADMIN') && <NavItem to="/admin/dashboard" label="Admin" />}
            </nav>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {auth.token ? (
            <>
              <NotificationBell />
              <span className="hidden max-w-[18rem] truncate text-sm font-semibold text-slate-600 sm:block">
                {auth.email ?? ''}
              </span>
              <button className="btn primary" onClick={logout}>
                Déconnexion
              </button>
            </>
          ) : (
            <NavItem to="/login" label="Connexion" />
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {auth.token ? (
        <div className="flex w-full flex-wrap gap-1 px-4 pb-3 sm:px-6 lg:hidden 2xl:px-12">
          {auth.hasRole('BUREAU_ORDRE') && <NavItem to="/bureau-ordre" label="Bureau d’ordre" />}
          {auth.hasRole('COORDINATEUR') && <NavItem to="/coordinateur" label="Coordinateur" />}
          {auth.hasRole('SCANNER') && <NavItem to="/scanner" label="Scanner" />}
          {auth.hasRole('VERIFICATEUR') && <NavItem to="/verificateur" label="Vérificateur" />}
          {(auth.hasRole('RESPONSABLE_CLIENT') || auth.hasRole('RESPONSABLE_CLIENT_PROD')) && <NavItem to="/responsable-client" label="Responsable client" />}
          {auth.hasRole('COURSIER') && <NavItem to="/coursier" label="Coursier" />}
          <NavItem to="/chat" label="Chat" />
          {auth.hasRole('ADMIN') && <NavItem to="/admin/dashboard" label="Admin" />}
        </div>
      ) : null}
    </header>
  );
}
