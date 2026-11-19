// « ‹ 1 2 3 … 9 › »   (reusable: pass the current page, total pages and a change handler)
function pageList(page, pages, maxVisible) {
  if (maxVisible) { // fixed window of N page numbers around the current page, no "…"
    const n = Math.min(maxVisible, pages);
    const start = Math.min(Math.max(page - Math.floor(n / 2), 1), pages - n + 1);
    return Array.from({ length: n }, (_, i) => start + i);
  }
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  keep.forEach((n, i) => {
    if (i) {
      const gap = n - keep[i - 1];
      if (gap === 2) out.push(n - 1);      // only one page hidden -> just show it
      else if (gap > 2) out.push("gap" + i); // several hidden -> …
    }
    out.push(n);
  });
  return out;
}

// maxVisible (optional): show only that many page numbers, e.g. 3 -> « ‹ 2 3 4 › »
export default function Pagination({ page, pages, onChange, maxVisible }) {
  const go = (p) => () => onChange(Math.min(Math.max(p, 1), pages));
  return (
    <nav className="pgn" aria-label="Pagination">
      <button type="button" onClick={go(1)} disabled={page <= 1} aria-label="First page" title="First page">«</button>
      <button type="button" onClick={go(page - 1)} disabled={page <= 1} aria-label="Previous page" title="Previous page">‹</button>
      {pageList(page, pages, maxVisible).map((n) =>
        typeof n === "string"
          ? <span key={n} className="pgn-gap">…</span>
          : <button key={n} type="button" onClick={go(n)} className={n === page ? "on" : ""} aria-current={n === page ? "page" : undefined}>{n}</button>
      )}
      <button type="button" onClick={go(page + 1)} disabled={page >= pages} aria-label="Next page" title="Next page">›</button>
      <button type="button" onClick={go(pages)} disabled={page >= pages} aria-label="Last page" title="Last page">»</button>
    </nav>
  );
}