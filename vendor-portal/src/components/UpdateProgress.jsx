import { useMemo, useState } from "react";
import api, { errorText } from "../api";
import Icon from "./Icon";
import "../progress.css";

const localDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA") : ""); // the vendor's own calendar day, not UTC
const pcs = (n) => `${Number(n || 0).toLocaleString("en-IN")} pcs`;
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the vendor's own timezone

// quick buttons on the right: one per move the server allows for this job
const quickOf = (value, job) => ({
  accepted: { icon: "checkcircle", label: "Accept Job" },
  rejected: { icon: "close", label: "Reject Job" },
  in_progress: job.status === "in_progress" ? { icon: "gear", label: "Mark as In Progress" } : { icon: "play", label: "Mark as Started" },
  ready: { icon: "checkcircle", label: "Mark as Ready for Pickup" },
}[value]);

/* Single-screen "Update Work Progress" dialog (one click on Save).  job = the full job from GET /vendor/jobs/<id>/ ; onSaved(job) gets the updated job. */
export default function UpdateProgress({ job, onClose, onSaved }) {
  const total = job.qty || 0;
  const doneBefore = job.qty_done || 0;
  const left = Math.max(0, total - doneBefore);
  const options = job.next_options.map((o) => ({
    value: o.value,
    label: o.value === job.status ? job.status_label : o.label,
  }));

  const [status, setStatus] = useState(options[0]?.value || "");
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState("");
  const [auto, setAuto] = useState(false); // qty was filled in by us (not typed), so it may be cleared again
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // does this move need a quantity?
  //   none     - accepting / rejecting a job: nothing has been made yet
  //   optional - starting production: may already have some pieces done
  //   required - progress update, or marking ready for pickup
  const modeOf = (value) => {
    if (value !== job.status && (value === "accepted" || value === "rejected")) return "none";
    if (value === "in_progress" && job.status === "accepted") return "optional";
    return "required";
  };
  const mode = modeOf(status);
  const isUpdate = status === job.status; // progress update: status stays the same
  const n = mode === "none" || qty === "" ? 0 : Number(qty);
  const after = doneBefore + (Number.isFinite(n) ? n : 0);
  const minDate = localDay(job.assigned_at);
  const saveLabel = status === "accepted" && !isUpdate ? "Accept Job" : status === "rejected" && !isUpdate ? "Reject Job" : "Save Update";

  const pick = (value) => {
    setStatus(value);
    setError("");
    if (value === "ready" && qty === "" && left > 0) { setQty(String(left)); setAuto(true); } // finishing: suggest the rest
    else if (auto) { setQty(""); setAuto(false); } // drop the suggestion when leaving "ready"
  };

  const validate = () => {
    if (!status) return "Choose a status.";
    if (!date) return "Choose the progress date.";
    if (date > today()) return "Progress date cannot be in the future.";
    if (minDate && date < minDate) return "Progress date cannot be before the job was assigned.";
    if (status === "rejected" && !remarks.trim()) return "Please add remarks saying why you are rejecting this job.";
    if (mode !== "none") {
      if (qty === "" && mode === "required") return "Enter the quantity completed this time (0 or more).";
      if (qty !== "" && (!Number.isInteger(n) || n < 0)) return "Quantity must be a whole number, 0 or more.";
      if (n > left) return `Only ${left} pcs are left to complete.`;
      if (isUpdate && n === 0 && !remarks.trim()) return "Enter the quantity completed this time, or add a remark.";
    }
    return "";
  };

  const save = async () => {
    if (busy) return;
    const e = validate();
    if (e) return setError(e);
    setBusy(true); setError("");
    try {
      const r = await api.patch(`/vendor/jobs/${job.id}/`, { status, progress_date: date, remarks, ...(mode === "none" ? {} : { qty_done: qty }) });
      onSaved(r.data.job);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  const pct = (x) => (total ? Math.min(100, (x / total) * 100) : 0);
  const warn = mode !== "none" && status === "ready" && after < total
    ? `Only ${pcs(after)} of ${pcs(total)} will be done. Mark ready only if the remaining ${pcs(total - after)} is not pending.` : "";

  return (
    <div className="up-modal" role="dialog" aria-modal="true" aria-labelledby="up-title">
      <div className="up-dialog">
        <div className="up-head"><h2 id="up-title">Update Work Progress</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="close" size={22} /></button></div>

        <div className="up-body">
          {error && <div className="alert error up-err" role="alert"><span>{error}</span></div>}

          <div className="up-grid">
              <div className="up-form">
                <div className="field">
                  <label htmlFor="up-status">Status <b className="req">*</b></label>
                  <select id="up-status" className="aw-select" value={status} onChange={(e) => pick(e.target.value)}>
                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="up-date">Progress Date <b className="req">*</b></label>
                  <input id="up-date" type="date" value={date} min={minDate} max={today()} onChange={(e) => setDate(e.target.value)} />
                </div>
                {mode !== "none" && <>
                  <div className="field">
                    <label htmlFor="up-qty">Quantity Completed (this time) {mode === "required" ? <b className="req">*</b> : <small>(optional)</small>}</label>
                    <input id="up-qty" type="number" inputMode="numeric" min="0" max={left} step="1" value={qty} onChange={(e) => { setQty(e.target.value); setAuto(false); }} placeholder="0" />
                  </div>
                  <div className="field">
                    <label htmlFor="up-total">Total Completed Quantity</label>
                    <input id="up-total" className="ro" readOnly value={`${after} / ${total} pcs`} />
                  </div>
                </>}
                <div className="field wide">
                  <label htmlFor="up-remarks">Remarks / Notes {status === "rejected" && <b className="req">(required)</b>}</label>
                  <textarea id="up-remarks" rows="4" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Second batch completed and continuing remaining work." />
                </div>
              </div>

              <aside className="up-quick">
                <h3>Quick Status Actions</h3>
                {options.map((o) => {
                  const q = quickOf(o.value, job);
                  if (!q || (o.value === job.status && job.status !== "in_progress")) return null;
                  return (
                    <button type="button" key={o.value} className={status === o.value ? "on" : ""} onClick={() => pick(o.value)}>
                      <Icon name={q.icon} size={18} /><span>{q.label}</span><Icon name="chevright" size={15} />
                    </button>
                  );
                })}
              </aside>
            </div>

          {(mode !== "none" || warn) && (
            <div className="up-sum">
              {mode !== "none" && <>
                <div className="up-bar" role="img" aria-label={`${doneBefore} done before, ${n} this time, ${total - after} remaining`}>
                  <span className="b1" style={{ width: `${pct(doneBefore)}%` }} />
                  <span className="b2" style={{ width: `${pct(n)}%` }} />
                </div>
                <ul className="up-legend">
                  <li><i className="b1" /> Done before <b>{pcs(doneBefore)}</b></li>
                  <li><i className="b2" /> This update <b>{pcs(n)}</b></li>
                  <li><i className="b3" /> Remaining <b>{pcs(Math.max(0, total - after))}</b></li>
                </ul></>}
              {warn && <div className="alert warn">{warn}</div>}
            </div>
          )}
        </div>

        <div className="up-foot">
          <button type="button" className="aw-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="aw-btn accent" onClick={save} disabled={busy}>{busy ? "Saving…" : saveLabel}</button>
        </div>
      </div>
    </div>
  );
}