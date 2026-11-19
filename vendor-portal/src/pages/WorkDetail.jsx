import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import StatusChip, { fmtDate } from "../components/StatusChip";
import UpdateProgress from "../components/UpdateProgress";
import "../workdetail.css";

const rupees = (v) => (v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pcs = (n) => (n || n === 0 ? `${Number(n).toLocaleString("en-IN")} pcs` : "-");

export default function WorkDetail() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [open, setOpen] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(""); setNotFound(false);
    api.get(`/vendor/jobs/${id}/`, { signal: ctrl.signal })
      .then((r) => setJob(r.data.job))
      .catch((e) => {
        if (e.code === "ERR_CANCELED") return;
        if (e.response?.status === 404) setNotFound(true); else setError(errorText(e));
      });
    return () => ctrl.abort();
  }, [id, tries]);

  if (notFound) {
    return (
      <div className="wd"><Link to="/assigned" className="wd-back"><Icon name="arrowleft" size={16} /> Back to Assigned Work</Link>
        <div className="vd-card soon"><h1>Job not found</h1><p>This job does not exist or is not assigned to you.</p></div></div>
    );
  }
  if (!job) {
    return (
      <div className="wd"><Link to="/assigned" className="wd-back"><Icon name="arrowleft" size={16} /> Back to Assigned Work</Link>
        {error ? <div className="alert error"><span>{error}</span><button type="button" onClick={() => setTries((t) => t + 1)}><Icon name="refresh" size={14} /> Retry</button></div>
          : <div className="wd-card"><div className="vd-skel">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div></div>}</div>
    );
  }

  const canUpdate = job.next_options.length > 0;
  const rate = job.price !== null && job.qty ? Number(job.price) / job.qty : null;
  const info = [
    ["Order No.", job.order_no], ["Work Type", job.items_text || "—"], ["Product", job.product || "—"],
    ["Quantity Assigned", pcs(job.qty)], ["Completed So Far", `${Number(job.qty_done).toLocaleString("en-IN")} / ${pcs(job.qty)}`], ["Rate (per piece)", rupees(rate)], ["Expected Amount", rupees(job.price)],
    ["Assigned Date", fmtDate(job.assigned_at)], ["Due Date", fmtDate(job.due_date)],
  ];
  const lines = (job.instructions || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const orderNotes = (job.order_instructions || "").trim();

  return (
    <div className="wd">
      <div className="wd-bar">
        <Link to="/assigned" className="wd-back"><Icon name="arrowleft" size={16} /> Back to Assigned Work</Link>
        <div className="wd-title"><h1>Work Details</h1><StatusChip status={job.status} label={job.status_label} overdue={job.is_overdue} /></div>
        <div className="wd-btns">
          <button type="button" className="aw-btn dark" onClick={() => window.print()}><Icon name="print" size={17} /> Print</button>
          {canUpdate && <button type="button" className="aw-btn accent" onClick={() => setOpen(true)}>Update Progress</button>}
        </div>
      </div>

      {error && <div className="alert error"><span>{error}</span></div>}

      <section className="wd-card">
        <div className="wd-grid">
          <dl className="wd-info">
            {info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            <div><dt>Current Status</dt><dd><StatusChip status={job.status} label={job.status_label} overdue={job.is_overdue} /></dd></div>
          </dl>

          <div className="wd-box">
            <h3>Items in this job</h3>
            <ul className="wd-items">
              {job.lines.map((l, i) => (
                <li key={i}>
                  <div className="wd-item-top"><b>{l.service_name}</b><span>{pcs(l.qty)}</span></div>
                  {(l.spec || []).filter((s) => s && s.value).map((s, j) => <div className="wd-spec" key={j}><span>{s.label}</span><span>{s.value}</span></div>)}
                  {l.file_links?.length > 0 && <div className="wd-files">
                    <span className="wd-files-title">Artwork files</span>
                    <ul>
                      {l.file_links.map((f, k) => <li key={k}>
                        {f.url
                          ? <a href={f.url} className="wd-file" title={`Download ${f.name}`}><Icon name="download" size={14} /> {f.name}</a>
                          : <span className="wd-file off" title="Star Offset will send this file to you separately"><Icon name="mail" size={14} /> {f.name} <small>sent separately</small></span>}
                      </li>)}
                    </ul>
                  </div>}
                </li>
              ))}
            </ul>
          </div>

          <div className="wd-side">
            <div className="wd-box">
              <h3>Special Instructions</h3>
              {lines.length > 1 ? <ul className="wd-bullets">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                : <p className={lines.length ? "" : "muted"}>{lines[0] || "No special instructions."}</p>}
            </div>
            {orderNotes && <div className="wd-box"><h3>Order Notes</h3><p>{orderNotes}</p></div>}
            {job.vendor_note && <div className="wd-box"><h3>Your Note</h3><p>{job.vendor_note}</p></div>}
          </div>
        </div>
      </section>

      <section className="wd-history">
        <h2>Progress History</h2>
        <div className="wd-card flat"><div className="aw-table-wrap">
          <table className="aw-table wd-table">
            <thead><tr><th>#</th><th>Date</th><th>Status</th><th>Quantity</th><th>Remarks</th><th>Updated By</th></tr></thead>
            <tbody>
              {job.history.map((h, i) => (
                <tr key={i}>
                  <td>{i + 1}</td><td>{fmtDate(h.date)}</td>
                  <td><StatusChip status={h.status} label={h.status_label} /></td>
                  <td>{h.qty === null || h.qty === undefined ? "—" : pcs(h.qty)}</td><td className="wrap">{h.remarks || "—"}</td><td>{h.by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </section>

      {open && <UpdateProgress job={job} onClose={() => setOpen(false)} onSaved={(j) => { setJob(j); setOpen(false); }} />}
    </div>
  );
}
