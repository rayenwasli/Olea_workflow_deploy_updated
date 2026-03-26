import React from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { ProtectedRoute } from './auth/ProtectedRoute';

import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { QueuePage } from './pages/QueuePage';
import { BordereauDetails } from './pages/BordereauDetails';
import { ChatPage } from './chat/ChatPage';
import { NotificationsPage } from './pages/NotificationsPage';

import { AdminLayout } from './admin/AdminLayout';
import { AdminDashboard } from './admin/AdminDashboard';
import { RoleDashboardPage } from './admin/RoleDashboard';
import { AdminUsers } from './admin/AdminUsers';
import { AdminClients } from './admin/AdminClients';
import { AdminAssureurs } from './admin/AdminAssureurs';
import { AdminAffectations } from './admin/AdminAffectations';
import { AdminBordereaux } from './admin/AdminBordereaux';
import { AdminUndoRequests } from './admin/AdminUndoRequests';
import { AdminAlerts } from './admin/AdminAlerts';
import { AdminNumericStats } from './admin/AdminNumericStats';
import { AdminDocumentTypes } from './admin/AdminDocumentTypes';

export function App() {
  const location = useLocation();
  const isLogin = location.pathname === '/login';

  const routes = (
    <Routes>

          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/bureau-ordre"
            element={
              <ProtectedRoute roles={['BUREAU_ORDRE']}>
                <QueuePage role="BUREAU_ORDRE" title="Bureau d’ordre" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coordinateur"
            element={
              <ProtectedRoute roles={['COORDINATEUR']}>
                <QueuePage role="COORDINATEUR" title="Coordinateur" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scanner"
            element={
              <ProtectedRoute roles={['SCANNER']}>
                <QueuePage role="SCANNER" title="Scanner" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/verificateur"
            element={
              <ProtectedRoute roles={['VERIFICATEUR']}>
                <QueuePage role="VERIFICATEUR" title="Vérificateur" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/responsable-client"
            element={
              <ProtectedRoute roles={['RESPONSABLE_CLIENT','RESPONSABLE_CLIENT_PROD']}>
                <QueuePage role="RESPONSABLE_CLIENT" title="Responsable client" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coursier"
            element={
              <ProtectedRoute roles={['COURSIER']}>
                <QueuePage role="COURSIER" title="Coursier" />
              </ProtectedRoute>
            }
          />

          <Route
            path="/bordereaux/:id"
            element={
              <ProtectedRoute>
                <BordereauDetails />
              </ProtectedRoute>
            }
          />

          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="dashboard/role/:role" element={<RoleDashboardPage />} />
            <Route path="numeric-stats" element={<AdminNumericStats />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="document-types" element={<AdminDocumentTypes />} />
            <Route path="clients" element={<AdminClients />} />
            <Route path="assureurs" element={<AdminAssureurs />} />
            <Route path="affectations" element={<AdminAffectations />} />
            <Route path="bordereaux" element={<AdminBordereaux />} />
            <Route path="alerts" element={<AdminAlerts />} />
            <Route path="undo-requests" element={<AdminUndoRequests />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        
    </Routes>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {isLogin ? null : <NavBar />}
      {/*
        Full-width app shell (requested) with responsive gutters.
        Pages can still optionally constrain their own content where it makes sense.
      */}
      <main className={isLogin ? '' : 'w-full px-4 py-6 sm:px-6 lg:px-8 2xl:px-12'}>
        {routes}
      </main>
    </div>
  );
}
