import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useLocation } from 'react-router-dom';

import { http } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../notifications/ToastProvider';
import { useNotifications } from '../notifications/NotificationCenter';
import { useNotificationSound } from '../notifications/useNotificationSound';
import type { NotificationItem } from '../notifications/NotificationCenter';
import type { ChatMessage, BordereauStatus } from '../types';

type MeDto = { id: number; email: string };
type ChatUserDto = { id: number; email: string };

type BordereauStatusChangedPayload = {
  bordereauId: number;
  reference: string;
  clientId?: number | null;
  clientName?: string | null;
  fromStatus?: BordereauStatus | null;
  toStatus: BordereauStatus;
  changedByUserId?: number;
  changedByEmail?: string;
  changedAt?: string;
};

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
  RECU_DU_RESPONSABLE: 'Reçu du responsable client',
  DONNE_AU_COURSIER: 'Donné au coursier',
  FINALISE: 'Finalisé',
  VALIDE: 'Validé',
};

function shortPreview(m: ChatMessage) {
  if (m.type === 'TEXT') {
    const t = (m.content ?? '').trim();
    return t.length > 80 ? t.slice(0, 80) + '…' : t;
  }
  if (m.type === 'IMAGE') return '📷 Image';
  if (m.type === 'VOICE') return '🎤 Message vocal';
  const isPdf = (m.mimeType ?? '').toLowerCase() === 'application/pdf' || (m.fileName ?? m.content ?? '').toLowerCase().endsWith('.pdf');
  if (isPdf) return '📄 PDF';
  return '📎 Fichier';
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const toast = useToast();
  const { add: addNotification } = useNotifications();
  const playNotificationSound = useNotificationSound();
  const location = useLocation();

  const [me, setMe] = useState<MeDto | null>(null);
  const [userEmailById, setUserEmailById] = useState<Map<number, string>>(new Map());

  const socketRef = useRef<Socket | null>(null);
  const seenMsg = useRef(new Set<number>());
  const seenStatus = useRef(new Set<string>());
  const meRef = useRef<MeDto | null>(null);
  const userMapRef = useRef<Map<number, string>>(new Map());

  const isOnChat = useMemo(() => location.pathname.startsWith('/chat'), [location.pathname]);
  const isOnNotifications = useMemo(() => location.pathname.startsWith('/notifications'), [location.pathname]);
  const isOnAdminAlerts = useMemo(() => location.pathname.startsWith('/admin/alerts'), [location.pathname]);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    userMapRef.current = userEmailById;
  }, [userEmailById]);

  // Load identity + user map (for nicer message toasts)
  useEffect(() => {
    if (!auth.token) {
      setMe(null);
      setUserEmailById(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const meRes = await http.get<MeDto>('/chat/me');
        const usersRes = await http.get<ChatUserDto[]>('/chat/users');
        if (cancelled) return;
        setMe({ id: meRes.data.id, email: meRes.data.email });
        const map = new Map<number, string>();
        for (const u of usersRes.data || []) map.set(Number(u.id), u.email);
        setUserEmailById(map);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.token]);

  // Socket connection
  useEffect(() => {
    if (!auth.token) return;

    const s = io('/', {
      path: '/ws',
      auth: { token: auth.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      timeout: 10_000,
    });

    socketRef.current = s;

    s.on('chat.message', (m: ChatMessage) => {
      // Avoid duplicates
      if (typeof m?.id === 'number' && m.id > 0) {
        if (seenMsg.current.has(m.id)) return;
        seenMsg.current.add(m.id);
      }

      const meId = meRef.current?.id;
      if (!meId) return;
      if (m.recipientId !== meId) return; // only incoming
      if (m.senderId === meId) return;

      const sender = userMapRef.current.get(Number(m.senderId)) || `Utilisateur #${m.senderId}`;

      // Always add to notification center (even if user is already on chat)
      addNotification({
        id: `chat:${m.id ?? `${m.senderId}_${m.sentAt ?? ''}`}`,
        kind: 'chat',
        title: `Message · ${sender}`,
        message: shortPreview(m),
        href: `/chat?user=${m.senderId}`,
      });

      // If user is already on chat screen, skip popup to avoid noise
      playNotificationSound();

      if (!isOnChat) {
        toast.push({
          title: `Nouveau message · ${sender}`,
          message: shortPreview(m),
          variant: 'info',
          href: `/chat?user=${m.senderId}`,
          durationMs: 6500,
        });
      }
    });

    s.on('bordereau.status_changed', (p: BordereauStatusChangedPayload) => {
      const key = `${p?.bordereauId || 'x'}_${p?.changedAt || ''}_${p?.toStatus || ''}`;
      if (seenStatus.current.has(key)) return;
      seenStatus.current.add(key);

      const meId = meRef.current?.id;
      if (meId && p?.changedByUserId && Number(p.changedByUserId) === Number(meId)) {
        return; // don't toast your own actions
      }

      const from = p?.fromStatus ? STATUS_LABEL[p.fromStatus] : null;
      const to = STATUS_LABEL[p.toStatus];
      const msg = from ? `Statut: ${from} → ${to}` : `Statut: ${to}`;

      addNotification({
        id: `bordereau:${key}`,
        kind: 'bordereau',
        title: `Bordereau ${p.reference}`,
        message: msg,
        href: `/bordereaux/${p.bordereauId}`,
      });

      playNotificationSound();

      toast.push({
        title: `Bordereau ${p.reference}`,
        message: msg,
        variant: p.toStatus === 'VALIDE' ? 'ok' : 'info',
        href: `/bordereaux/${p.bordereauId}`,
        durationMs: 6500,
      });
    });

    // Generic server-pushed notification (used by background alerts)
    s.on('notification.new', (n: NotificationItem) => {
      if (!n || !n.id || !n.title) return;
      addNotification({
        id: String(n.id),
        kind: (n.kind || 'system'),
        title: String(n.title),
        message: n.message ?? undefined,
        href: n.href ?? undefined,
        createdAt: typeof n.createdAt === 'number' ? n.createdAt : undefined,
        read: Boolean(n.read),
      });

      // Avoid popups if user is already looking at notifications/alerts
      playNotificationSound();

      if (isOnNotifications || isOnAdminAlerts) return;
      toast.push({
        title: String(n.title),
        message: n.message ? String(n.message) : undefined,
        variant: n.kind === 'bordereau' ? 'warn' : 'info',
        href: n.href ?? undefined,
        durationMs: 7500,
      });
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [auth.token, isOnChat, isOnNotifications, isOnAdminAlerts, toast, addNotification, playNotificationSound]);

  return <>{children}</>;
}
