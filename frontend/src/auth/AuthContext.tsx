import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http } from '../api/http';
import type { Authority, LoginResponse, RoleName } from '../types';

function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

export type AuthState = {
  token: string | null;
  roles: Authority[];
  email: string | null;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => void;
  hasAuthority: (a: Authority) => boolean;
  hasRole: (r: RoleName) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialToken = localStorage.getItem('scan.token') ?? sessionStorage.getItem('scan.token');
  const [token, setToken] = useState<string | null>(initialToken);

  const persistMode = () => (localStorage.getItem('scan.persist') === 'session' ? 'session' : 'local');
  const pickStorage = () => (persistMode() === 'session' ? sessionStorage : localStorage);
  const otherStorage = () => (persistMode() === 'session' ? localStorage : sessionStorage);
  const [roles, setRoles] = useState<Authority[]>(() => {
    const raw = localStorage.getItem('scan.roles') ?? sessionStorage.getItem('scan.roles');
    return raw ? (JSON.parse(raw) as Authority[]) : [];
  });
  const [email, setEmail] = useState<string | null>(() => {
    const t = localStorage.getItem('scan.token') ?? sessionStorage.getItem('scan.token');
    return t ? decodeJwtSub(t) : null;
  });

  useEffect(() => {
    const store = pickStorage();
    const other = otherStorage();

    if (token) {
      store.setItem('scan.token', token);
      store.setItem('scan.roles', JSON.stringify(roles));
      other.removeItem('scan.token');
      other.removeItem('scan.roles');
      setEmail(decodeJwtSub(token));
    } else {
      localStorage.removeItem('scan.token');
      localStorage.removeItem('scan.roles');
      sessionStorage.removeItem('scan.token');
      sessionStorage.removeItem('scan.roles');
      setEmail(null);
    }
  }, [token, roles]);

  const login = async (em: string, password: string) => {
    const res = await http.post<LoginResponse>('/auth/login', { email: em, password });
    setToken(res.data.accessToken);
    setRoles(res.data.roles);
    return res.data;
  };

  const logout = () => {
    setToken(null);
    setRoles([]);
  };

  const hasAuthority = (a: Authority) => roles.includes(a);
  const hasRole = (r: RoleName) => roles.includes((`ROLE_${r}` as Authority));

  const value = useMemo<AuthContextValue>(
    () => ({ token, roles, email, login, logout, hasAuthority, hasRole }),
    [token, roles, email]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
