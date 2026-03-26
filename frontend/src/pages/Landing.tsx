import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

function Feature({ title, desc, icon }: { title: string; desc: string; icon: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-olea-50 ring-1 ring-olea-100">
          {icon}
        </div>
        <div>
          <div className="text-base font-black tracking-tight text-slate-900">{title}</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">{desc}</div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="relative rounded-3xl border border-slate-200/70 bg-white/60 p-6 shadow-soft">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-olea-800 text-sm font-black text-white shadow-sm">
          {n}
        </div>
        <div>
          <div className="text-sm font-black text-slate-900">{title}</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">{desc}</div>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const auth = useAuth();

  const primaryCta = useMemo(() => {
    if (!auth.token) {
      return {
        label: 'Se connecter',
        to: '/login',
        kind: 'primary' as const,
      };
    }
    if (auth.hasRole('ADMIN')) return { label: 'Ouvrir le dashboard', to: '/admin/dashboard', kind: 'primary' as const };
    if (auth.hasRole('BUREAU_ORDRE')) return { label: 'Accéder à la file BO', to: '/bureau-ordre', kind: 'primary' as const };
    if (auth.hasRole('COORDINATEUR')) return { label: 'Accéder à la file Coord.', to: '/coordinateur', kind: 'primary' as const };
    if (auth.hasRole('SCANNER')) return { label: 'Accéder à la file Scanner', to: '/scanner', kind: 'primary' as const };
    if (auth.hasRole('VERIFICATEUR')) return { label: 'Accéder à la file Vérif.', to: '/verificateur', kind: 'primary' as const };
    if (auth.hasRole('RESPONSABLE_CLIENT')) return { label: 'Accéder à la file RC', to: '/responsable-client', kind: 'primary' as const };
    if (auth.hasRole('COURSIER')) return { label: 'Accéder à la file Coursier', to: '/coursier', kind: 'primary' as const };
    return { label: 'Ouvrir l’application', to: '/', kind: 'primary' as const };
  }, [auth]);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-olea-900 via-olea-800 to-olea-700 p-7 text-white shadow-soft sm:p-10">
        {/* ambient */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-40 h-[32rem] w-[32rem] rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -right-40 -bottom-48 h-[38rem] w-[38rem] rounded-full bg-amber-200/15 blur-3xl" />
        </div>

        <div className="relative grid gap-8 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/15">
              <span className="inline-flex h-2 w-2 rounded-full bg-amber-300" />
              Plateforme DocuFlow — workflow & traçabilité
            </div>

            <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Pilotez vos <span className="text-amber-200">bordereaux</span> avec une UX claire,
              <br className="hidden sm:block" />
              une traçabilité complète et un temps réel fiable.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/80 sm:text-base">
              DocuFlow centralise la création, le suivi, la priorisation et l’archivage des bordereaux.
              Chaque étape est horodatée, attribuée à un rôle et consultable en un clic.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link className={primaryCta.kind === 'primary' ? 'btn primary' : 'btn'} to={primaryCta.to}>
                {primaryCta.label}
              </Link>
              <Link className="btn" to="/chat">
                Ouvrir le chat
              </Link>
              <a className="btn" href="#how">
                Voir le fonctionnement
              </a>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <div className="text-xs font-semibold text-white/75">Réduction des délais</div>
                <div className="mt-1 text-sm font-black">Moins d’allers-retours, traitement plus rapide, priorisation des urgences.</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <div className="text-xs font-semibold text-white/75">Conformité & contrôle</div>
                <div className="mt-1 text-sm font-black">Journal d’audit, accès par rôle, actions sécurisées et consultables.</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <div className="text-xs font-semibold text-white/75">Pilotage & reporting</div>
                <div className="mt-1 text-sm font-black">Tableau de bord, export PDF, vision claire des blocages et volumes.</div>
              </div>
            </div>
          </div>

          {/* Illustration */}
          <div className="lg:col-span-5">
            <div className="relative overflow-hidden rounded-3xl bg-white/10 p-6 ring-1 ring-white/15">
              <div className="text-xs font-semibold text-white/75">Aperçu</div>
              <div className="mt-2 text-sm font-black">Workflow & pilotage</div>

              <div className="mt-5 grid gap-3">
                {[
                  { s: 'CREE', d: 'Création & référence' },
                  { s: 'DEPOSE_SCAN', d: 'Dépôt au scan (coord.)' },
                  { s: 'SCANNE', d: 'Scan & vérification' },
                  { s: 'VALIDE', d: 'Validation & clôture' },
                ].map((x) => (
                  <div key={x.s} className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                    <span className="text-xs font-black tracking-wide">{x.s}</span>
                    <span className="text-xs text-white/75">{x.d}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl bg-gradient-to-r from-amber-300/20 to-white/5 p-4 ring-1 ring-white/10">
                <div className="text-xs font-semibold text-white/75">Bonus</div>
                <div className="mt-1 text-sm font-black">Priorités + export PDF du dashboard</div>
                <div className="mt-1 text-xs text-white/70">Des décisions rapides avec un reporting propre.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Feature
          title="Files par rôle + priorités"
          desc="Chaque rôle voit sa file de travail. Les urgences sont triées par rang, sans casser le flux."
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-olea-900" fill="none" aria-hidden="true">
              <path d="M4 6h16M4 12h10M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M19 11l2 2-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
        <Feature
          title="Traçabilité complète"
          desc="Historique horodaté, commentaires, pièces jointes, et contrôle des actions via JWT + rôles."
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-olea-900" fill="none" aria-hidden="true">
              <path d="M12 1 3 5v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V5l-9-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 12l2 2 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
        <Feature
          title="Temps réel fiable"
          desc="Chat interne (Socket.IO) + mises à jour instantanées. Gestion d’erreurs et reconnexion intégrées."
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-olea-900" fill="none" aria-hidden="true">
              <path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M8 9h8M8 13h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
      </section>

      {/* How it works */}
      <section id="how" className="space-y-4">
        <div className="card p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm font-black text-slate-900">Comment ça marche</div>
              <div className="muted">Un flux simple, standardisé, et mesurable.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="btn" to="/login">
                Connexion
              </Link>
              <Link className="btn" to="/admin/dashboard">
                Dashboard
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Step n="1" title="Création" desc="Le Bureau d’Ordre crée le bordereau et récupère les éléments." />
          <Step n="2" title="Scan & vérification" desc="Coordination → Scan → Vérification : une file par rôle, une action claire." />
          <Step n="3" title="Remise & validation" desc="Décharge, remise coursier, finalisation puis validation côté Responsable Client." />
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 p-7 text-white shadow-soft sm:p-10">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-48 top-0 h-[28rem] w-[28rem] rounded-full bg-olea-700/25 blur-3xl" />
          <div className="absolute -right-40 -bottom-40 h-[30rem] w-[30rem] rounded-full bg-amber-300/15 blur-3xl" />
        </div>

        <div className="relative grid gap-6 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-8">
            <div className="text-2xl font-black tracking-tight">Prêt à passer en production ?</div>
            <div className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
              Une base clean, dockerisée, orientée UX — avec un chat fonctionnel, un dashboard filtrable et un export PDF propre.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:col-span-4 lg:justify-end">
            <Link className="btn primary" to={primaryCta.to}>
              {primaryCta.label}
            </Link>
            <Link className="btn" to="/chat">
              Chat
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
