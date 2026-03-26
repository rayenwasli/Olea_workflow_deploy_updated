import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './notifications/ToastProvider';
import { NotificationProvider } from './notifications/NotificationCenter';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <ToastProvider>
          <NotificationProvider>
            <RealtimeProvider>
              <App />
            </RealtimeProvider>
          </NotificationProvider>
        </ToastProvider>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
