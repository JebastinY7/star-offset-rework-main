// « ‹ 1 2 3 › »  — first / previous / page numbers / next / last
export default function Pager({ page, pages, onChange, maxVisible = 3 }) {
  const n = Math.min(maxVisible, pages);
  const first = Math.min(Math.max(page - Math.floor(n / 2), 1), pages - n + 1);
  const nums = Array.from({ length: n }, (_, i) => first + i);
  const go = (p) => () => onChange(Math.min(Math.max(p, 1), pages));
  return (
    <nav className="aw-pager" aria-label="Pages">
      <button type="button" disabled={page <= 1} onClick={go(1)} aria-label="First page" title="First page">«</button>
      <button type="button" disabled={page <= 1} onClick={go(page - 1)} aria-label="Previous page" title="Previous page">‹</button>
      {nums.map((p) => (
        <button type="button" key={p} className={p === page ? "on" : ""} onClick={go(p)} aria-current={p === page ? "page" : undefined}>{p}</button>
      ))}
      <button type="button" disabled={page >= pages} onClick={go(page + 1)} aria-label="Next page" title="Next page">›</button>
      <button type="button" disabled={page >= pages} onClick={go(pages)} aria-label="Last page" title="Last page">»</button>
    </nav>
  );
}
