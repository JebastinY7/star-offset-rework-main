import Icon from "./Icon";

// Footer of a data table: "Showing 1 to 10 of 25 entries", page buttons and rows-per-page.
// page / pages / total / size come from the list; count = rows on this page.
export default function TablePager({ page, pages, total, count, size, onPage, onSize, sizes = [10, 20, 50] }) {
  const cur = Math.min(Math.max(page, 1), Math.max(pages, 1));
  const start = (cur - 1) * size;
  const first = Math.max(1, Math.min(cur - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, Math.max(pages, 1)) }, (_, i) => first + i);

  return (
    <div className="dt-foot">
      <span>{total ? `Showing ${start + 1} to ${start + count} of ${total} entries` : "Showing 0 entries"}</span>
      <div className="dt-right">
        <nav className="dt-pager" aria-label="Pages">
          <button type="button" disabled={cur <= 1} onClick={() => onPage(cur - 1)} aria-label="Previous page"><Icon name="arrowleft" size={16} /></button>
          {nums.map((n) => (
            <button type="button" key={n} className={n === cur ? "on" : ""} onClick={() => onPage(n)} aria-current={n === cur ? "page" : undefined}>{n}</button>
          ))}
          <button type="button" disabled={cur >= pages} onClick={() => onPage(cur + 1)} aria-label="Next page"><Icon name="arrow" size={16} /></button>
        </nav>
        <select className="dt-select" value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
          {sizes.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
    </div>
  );
}