import React from 'react';

export function Pagination({
  page,
  pages,
  size,
  total,
  onPageChange,
  onSizeChange,
  sizeOptions = [10, 25, 50, 100],
}: {
  page: number;
  pages: number;
  size: number;
  total: number;
  onPageChange: (nextPage: number) => void;
  onSizeChange?: (nextSize: number) => void;
  sizeOptions?: number[];
}) {
  const safePages = Math.max(1, pages || 1);
  const safePage = Math.min(Math.max(1, page || 1), safePages);

  const from = total === 0 ? 0 : (safePage - 1) * size + 1;
  const to = total === 0 ? 0 : Math.min(total, safePage * size);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="muted">
        {total === 0 ? 'Aucun élément.' : <>Affichage <b>{from}</b>–<b>{to}</b> sur <b>{total}</b></>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          title="Page précédente"
        >
          ←
        </button>

        <span className="badge">
          Page <b>{safePage}</b> / <b>{safePages}</b>
        </span>

        <button
          className="btn"
          disabled={safePage >= safePages}
          onClick={() => onPageChange(safePage + 1)}
          title="Page suivante"
        >
          →
        </button>

        {onSizeChange ? (
          <select
            className="input"
            style={{ width: 150 }}
            value={size}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            title="Taille de page"
          >
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
