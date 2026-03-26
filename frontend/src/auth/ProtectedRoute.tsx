import React from 'react';
import { Navigate } from 'react-router-dom';
import type { RoleName } from '../types';
import { useAuth } from './AuthContext';

export function ProtectedRoute({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: RoleName[];
}) {
  const auth = useAuth();

  if (!auth.token) return <Navigate to="/login" replace />;

  if (roles && roles.length) {
    const ok = roles.some((r) => auth.hasRole(r));
    if (!ok) return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
