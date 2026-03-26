import React, { useMemo } from 'react';

import { Modal } from './Modal';

type AttachmentPreviewModalProps = {
  open: boolean;
  onClose: () => void;
  url: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  title?: string;
};

function extOf(name?: string | null) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  return name.slice(i + 1).toLowerCase();
}

function nameFromUrl(url?: string | null) {
  if (!url) return 'pièce-jointe';
  try {
    const parsed = new URL(url, window.location.origin);
    const raw = parsed.pathname.split('/').pop() || 'piece-jointe';
    return decodeURIComponent(raw);
  } catch {
    const raw = url.split('/').pop() || 'piece-jointe';
    return decodeURIComponent(raw.split('?')[0]);
  }
}

function isPreviewableImage(mime?: string | null, fileName?: string | null, url?: string | null) {
  const m = (mime ?? '').toLowerCase();
  const ext = extOf(fileName) || extOf(url ?? null);

  const byMime = m.startsWith('image/')
    ? ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'].includes(m)
    : false;

  const byExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);

  return byMime || byExt;
}

function isPdf(mime?: string | null, fileName?: string | null, url?: string | null) {
  if ((mime ?? '').toLowerCase() === 'application/pdf') return true;
  const ext = extOf(fileName) || extOf(url ?? null);
  return ext === 'pdf';
}

export function AttachmentPreviewModal({
  open,
  onClose,
  url,
  fileName,
  mimeType,
  title,
}: AttachmentPreviewModalProps) {
  const resolvedName = useMemo(() => fileName || nameFromUrl(url), [fileName, url]);
  const previewImage = isPreviewableImage(mimeType, resolvedName, url);
  const previewPdf = isPdf(mimeType, resolvedName, url);

  return (
    <Modal
      open={open && !!url}
      onClose={onClose}
      title={title ?? resolvedName}
      width={1160}
      footer={
        url ? (
          <>
            <button className="btn" onClick={onClose}>Fermer</button>
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              Ouvrir dans un nouvel onglet
            </a>
            <a className="btn primary" href={url} download={resolvedName}>
              Télécharger
            </a>
          </>
        ) : undefined
      }
    >
      {url ? (
        <div className="flex flex-col gap-3">
          <div className="muted break-all text-xs">
            {resolvedName}
            {mimeType ? ` • ${mimeType}` : ''}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50" style={{ height: '72vh' }}>
            {previewImage ? (
              <div className="flex h-full items-center justify-center bg-slate-100 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={resolvedName}
                  className="max-h-full max-w-full rounded-xl object-contain shadow-sm"
                />
              </div>
            ) : previewPdf ? (
              <iframe
                title={resolvedName}
                src={url}
                className="h-full w-full bg-white"
              />
            ) : (
              <iframe
                title={resolvedName}
                src={url}
                className="h-full w-full bg-white"
              />
            )}
          </div>

          {!previewImage && !previewPdf ? (
            <div className="muted text-sm">
              Si l’aperçu n’est pas supporté par le navigateur, utilisez le bouton <b>Télécharger</b>.
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
