import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Authority } from '../types';
import logoUrl from '../../olea-logo.jpg';

function pickHome(roles: Authority[]): string {
  const has = (a: Authority) => roles.includes(a);
  if (has('ROLE_ADMIN')) return '/admin/dashboard';
  if (has('ROLE_BUREAU_ORDRE')) return '/bureau-ordre';
  if (has('ROLE_COORDINATEUR')) return '/coordinateur';
  if (has('ROLE_SCANNER')) return '/scanner';
  if (has('ROLE_VERIFICATEUR')) return '/verificateur';
  if (has('ROLE_RESPONSABLE_CLIENT')) return '/responsable-client';
  if (has('ROLE_RESPONSABLE_CLIENT_PROD')) return '/responsable-client';
  if (has('ROLE_COURSIER')) return '/coursier';
  return '/';
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
      {children}
    </span>
  );
}

function Eye({ off }: { off?: boolean }) {
  return off ? (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9.9 4.3A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-3.4 4.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.1 6.1C2.9 8.3 2 12 2 12s3.5 8 10 8c1 0 1.9-.2 2.8-.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Alert({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  const base = 'rounded-2xl border px-4 py-3 text-sm leading-6';
  const styles =
    kind === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700'
      : kind === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-white/60 text-slate-700';

  return <div className={`${base} ${styles}`}>{children}</div>;
}

export function Login() {
  const auth = useAuth();
  const nav = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // UX: focus email on mount
    emailRef.current?.focus();
  }, []);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.trim().length > 0 && !loading;
  }, [email, password, loading]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      localStorage.setItem('scan.persist', remember ? 'local' : 'session');
      const res = await auth.login(email.trim(), password);
      nav(pickHome(res.roles));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Connexion impossible');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Soft OLEA background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-olea-500/25 blur-3xl" />
        <div className="absolute -right-40 -top-48 h-[40rem] w-[40rem] rounded-full bg-olea-800/20 blur-3xl" />
        <div className="absolute left-1/2 top-[70%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-amber-200/30 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-stretch px-4 py-10">
        <div className="grid w-full items-stretch gap-6 lg:grid-cols-2">
          {/* Brand / Value prop */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-olea-800 to-olea-700 p-8 text-white shadow-soft">
            <div className="pointer-events-none absolute inset-0 opacity-[0.20]">
              <svg className="h-full w-full" viewBox="0 0 600 600" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="2" fill="white" />
                  </pattern>
                </defs>
                <rect width="600" height="600" fill="url(#dots)" />
              </svg>
            </div>

            <div className="relative flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                <img src={logoUrl} alt="OLEA" className="h-7 w-10 object-contain" />
              </div>
              <div>
                <div className="text-xs font-semibold tracking-wide text-white/80">Plateforme</div>
                <div className="text-2xl font-black tracking-tight">DocuFlow</div>
              </div>
              <div className="ml-auto hidden rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/15 sm:block">
                #BeAFRICA
              </div>
            </div>

            <h1 className="relative mt-10 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              Bordereaux, workflow,
              <span className="text-olea-500"> collaboration</span>.
            </h1>
            <p className="relative mt-4 max-w-md text-sm leading-6 text-white/80">
              Une expérience rapide, claire et maîtrisée — conçue pour les équipes opérationnelles.
            </p>

            <div className="relative mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <div className="flex items-start gap-3">
                  <Icon>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                      <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M5 3h14a2 2 0 0 1 2 2v14l-3-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                  </Icon>
                  <div>
                    <div className="text-sm font-bold">Workflow</div>
                    <div className="mt-1 text-xs text-white/75">États & historique</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <div className="flex items-start gap-3">
                  <Icon>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                      <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M4 15h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M7 8h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </Icon>
                  <div>
                    <div className="text-sm font-bold">Pilotage</div>
                    <div className="mt-1 text-xs text-white/75">Files & priorités</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <div className="flex items-start gap-3">
                  <Icon>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                      <path d="M12 1 3 5v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V5l-9-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M9 12l2 2 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Icon>
                  <div>
                    <div className="text-sm font-bold">Sécurité</div>
                    <div className="mt-1 text-xs text-white/75">JWT + rôles</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative mt-10 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/15">
                Frontend: <span className="ml-1 text-white">:4200</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/15">
                API: <span className="ml-1 text-white">:8080</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/15">
                WebSocket: <span className="ml-1 text-white">/ws</span>
              </span>
            </div>

            <div className="relative mt-6 text-xs text-white/70">
              © {new Date().getFullYear()} OLEA — DocuFlow
            </div>
          </div>

          {/* Form */}
          <div className="olea-card flex flex-col justify-center p-8 sm:p-10">
            <div className="flex items-start gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-500">Bienvenue</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-slate-900">Connexion</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  Connectez-vous pour accéder à votre espace.
                </div>
              </div>
            </div>

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div className="relative">
                <input
                  ref={emailRef}
                  id="email"
                  className="peer w-full rounded-2xl border-slate-200 bg-white/80 px-4 pb-2 pt-6 text-slate-900 placeholder-transparent shadow-sm olea-focus"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  inputMode="email"
                  placeholder="Email"
                />
                <label
                  htmlFor="email"
                  className="pointer-events-none absolute left-4 top-2 text-xs font-semibold text-slate-500 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-medium peer-focus:top-2 peer-focus:text-xs peer-focus:font-semibold"
                >
                  Email
                </label>
              </div>

              <div className="relative">
                <input
                  id="password"
                  className="peer w-full rounded-2xl border-slate-200 bg-white/80 px-4 pb-2 pt-6 pr-12 text-slate-900 placeholder-transparent shadow-sm olea-focus"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock((e as any).getModifierState?.('CapsLock') ?? false)}
                  autoComplete="current-password"
                  placeholder="Mot de passe"
                />
                <label
                  htmlFor="password"
                  className="pointer-events-none absolute left-4 top-2 text-xs font-semibold text-slate-500 transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm peer-placeholder-shown:font-medium peer-focus:top-2 peer-focus:text-xs peer-focus:font-semibold"
                >
                  Mot de passe
                </label>

                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <Eye off={showPassword} />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-olea-800 focus:ring-olea-500/30"
                  />
                  Se souvenir de moi
                </label>

                <button
                  type="button"
                  className="text-sm font-semibold text-olea-800 hover:text-olea-700"
                  onClick={() => setInfo('Réinitialisation du mot de passe : contactez votre administrateur.')}
                >
                  Mot de passe oublié ?
                </button>
              </div>

              {capsLock ? <Alert kind="warn">Caps Lock est activé.</Alert> : null}
              {error ? <Alert kind="danger">{error}</Alert> : null}
              {info ? <Alert>{info}</Alert> : null}

              <button
                className={`olea-btn-primary w-full ${canSubmit ? '' : 'opacity-60'}`}
                disabled={!canSubmit}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-3">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                    Connexion…
                  </span>
                ) : (
                  'Se connecter'
                )}
              </button>

              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600 ring-1 ring-slate-200/60">
                <div className="font-semibold text-slate-700">Support</div>
                <div className="mt-1">
                  Si vous rencontrez des problèmes pour vous connecter, contactez le département IT.
                </div>
              </div>
            </form>

            <div className="mt-8 flex items-center justify-between text-xs text-slate-500">
              <span>Propulsé par OLEA</span>
              <span className="rounded-full bg-olea-100 px-3 py-1 font-semibold text-olea-800">Choose OLEA</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
