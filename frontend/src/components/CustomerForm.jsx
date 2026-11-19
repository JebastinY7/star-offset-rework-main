import { useState } from "react";
import api, { errorText } from "../api";
import { CATEGORIES } from "./customerUtils";
import Icon from "./Icon";

const empty = { name: "", phone: "", category: "Customer", is_member: false, member_id: "", join_date: "", expiry_date: "" };

// Add / edit customer dialog. `initial` = {} for a new customer, or an existing customer object.
export default function CustomerForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState({
    ...empty, ...initial,
    member_id: initial?.member_id || "", join_date: initial?.join_date || "", expiry_date: initial?.expiry_date || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editing = !!initial?.id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    const body = { ...f };
    if (!f.is_member) { body.member_id = null; body.join_date = null; body.expiry_date = null; }
    else { body.join_date = f.join_date || null; body.expiry_date = f.expiry_date || null; }
    try {
      const r = editing
        ? await api.patch(`/customers/${initial.id}/`, body)
        : await api.post("/customers/", body);
      onSaved(r.data); // the saved customer, so Billing / New Order can select it straight away
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-bg">
      <form className="card modal wide" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head">
          <h2>{editing ? "Edit Customer" : "Add Customer"}</h2>
          <button type="button" onClick={onClose}><Icon name="close" size={14} /> Close</button>
        </div>

        <div className="modal-body">
          {error && <div className="error">{error}</div>}

          <div className="section-label">Basic information</div>
          <div className="form-grid">
            <label><span>Customer Name <span className="req">*</span></span>
              <input value={f.name} onChange={set("name")} required autoFocus />
            </label>
            <label><span>Phone Number <span className="req">*</span></span>
              <input value={f.phone} onChange={set("phone")} maxLength={10} inputMode="numeric" required />
            </label>
            <label><span>Customer Type <span className="req">*</span></span>
              <select value={f.category} onChange={set("category")}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            {editing && initial.Customer_code && (
              <label>Customer ID
                <input value={initial.Customer_code || ""} readOnly />
              </label>
            )}
          </div>

          <div className="section-label">Membership</div>
          <div className="form-grid">
            <label>Membership
              <select value={f.is_member ? "yes" : "no"} onChange={(e) => setF({ ...f, is_member: e.target.value === "yes" })}>
                <option value="no">No membership</option>
                <option value="yes">Member</option>
              </select>
            </label>
            {f.is_member && (
              <label><span>Membership ID <span className="req">*</span></span>
                <input value={f.member_id} onChange={set("member_id")} required />
              </label>
            )}
            {f.is_member && (
              <label>Join Date
                <input type="date" value={f.join_date} onChange={set("join_date")} />
              </label>
            )}
            {f.is_member && (
              <label>Membership Expiry
                <input type="date" value={f.expiry_date} onChange={set("expiry_date")} />
              </label>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save Customer"}</button>
        </div>
      </form>
    </div>
  );
}