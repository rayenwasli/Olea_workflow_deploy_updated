function intParam(v, fallback) {
  if (v == null || String(v).trim() === '') return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pagination helper.
 * Query params: page (1-indexed), size
 */
function parsePaging(query, opts = {}) {
  const defaultSize = opts.defaultSize ?? 25;
  const maxSize = opts.maxSize ?? 200;

  const page = Math.max(1, intParam(query.page, 1));
  const size = Math.min(maxSize, Math.max(1, intParam(query.size, defaultSize)));

  const limit = size;
  const offset = (page - 1) * size;

  return { page, size, limit, offset };
}

function shouldPaginate(query) {
  return query && (query.page != null || query.size != null || String(query.paginate || '') === '1');
}

function pageResponse({ items, page, size, total }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (size || 1)));
  return { items, page, size, total, pages };
}

module.exports = { parsePaging, shouldPaginate, pageResponse };
