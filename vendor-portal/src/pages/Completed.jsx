import { useState } from "react";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import { fmtDate } from "../components/StatusChip";
import StatusJobsPage from "../components/StatusJobsPage";

const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7); // YYYY-MM
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// work Star Offset has collected / closed. Filter by month, export that month as a CSV file.
export default function Completed() {
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const exportCsv = async () => {
    setBusy(true); setErr("");
    try {
      const all = [];
      for (let page = 1, pages = 1; page <= pages; page++) { // fetch every page of the chosen month
        const { data } = await api.get("/vendor/jobs/", { params: { status: "completed", month: month || undefined, sort: "recent", per_page: 50, page } });
        all.push(...data.results); pages = data.pages;
      }
      const lines = [["#", "Order No.", "Work Type", "Quantity", "Completed Date", "Status"].map(csv).join(",")];
      all.forEach((r, i) => lines.push([i + 1, r.order_no, r.items_text, r.qty, fmtDate(r.updated_at), "Completed"].map(csv).join(",")));
      const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `completed-work-${month || "all"}.csv` });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };

  return (
    <StatusJobsPage
      title="Completed Work" subtitle="All work completed and received by Star Offset Printing."
      status="completed" dateHead="Completed Date" dateOf={(r) => r.updated_at}
      params={{ month: month || undefined }} empty={month ? "No work was completed in this month." : "No work has been completed yet."}
      headerRight={
        <>
          {err && <span className="sl-err" role="alert">{err}</span>}
          <input type="month" className="sl-month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
          <button type="button" className="aw-btn accent" onClick={exportCsv} disabled={busy}><Icon name="download" size={17} /> {busy ? "Exporting…" : "Export"}</button>
        </>
      }
    />
  );
}
