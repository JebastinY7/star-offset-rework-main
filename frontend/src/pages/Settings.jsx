import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";
import ShopsPanel from "./ShopsPanel";
import VendorsPanel from "./VendorsPanel";
import "./billhistory.css"; // icon buttons (.bh-ico) with tooltips
import "./settings.css";

// Settings = left menu + one panel (admin only). The open section lives in the URL: /settings?tab=staff

const MIN_PASSWORD_LEN = 6; // same rule as the server
const ROLES = [["admin", "Admin"], ["manager", "Manager"], ["staff", "Staff"]];
const ROLE_LABEL = Object.fromEntries(ROLES);
const SECTIONS = [
  ["membership", "Membership", "card"],
  ["paper", "Paper Price", "tag"],
  ["staff", "Staff & Roles", "users"],
  ["shops", "Shop Management", "store"],
  ["vendors", "Vendor Management", "printer"],
  ["activity", "Activity Log", "history"],
  ["security", "Security", "lock"],
];

// one banner per panel; success clears itself
function useFlash() {
  const [flash, setFlash] = useState(null); // { type: "success" | "error", text }
  useEffect(() => {
    if (!flash || flash.type === "error") return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);
  return [
    flash,
    (text) => setFlash({ type: "success", text }),
    (err) => setFlash({ type: "error", text: typeof err === "string" ? err : errorText(err) }),
    () => setFlash(null),
  ];
}
const Flash = ({ flash }) => (flash ? <div className={flash.type === "error" ? "error" : "success"}>{flash.text}</div> : null);

// number boxes must not change when the mouse wheel scrolls over them
const noWheel = (e) => e.currentTarget.blur();

function PasswordInput({ label, value, onChange, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <label>
      <span className="lbl">{label}</span>
      <div className="pw-field">
        <input type={show ? "text" : "password"} value={value} onChange={onChange} {...rest} />
        <button type="button" className="pw-eye" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
    </label>
  );
}

function Panel({ title, subtitle, action, children }) {
  return (
    <section className="card st-panel">
      <div className="st-panel-head">
        <div><h2>{title}</h2><p className="muted">{subtitle}</p></div>
        {action}
      </div>
      <div className="st-body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------ Membership */
function MembershipPanel() {
  const [saved, setSaved] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, ok, fail, clear] = useFlash();

  useEffect(() => {
    api.get("/settings/membership/").then((r) => { setSaved(r.data); setF(r.data); }).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dirty = f && saved && ["membership_validity_days", "renewal_fee", "shop_renewal_fee"].some((k) => String(f[k]) !== String(saved[k]));

  const save = async (e) => {
    e.preventDefault();
    clear(); setBusy(true);
    try {
      const r = await api.patch("/settings/membership/", f);
      setSaved(r.data); setF(r.data);
      ok("Membership settings updated");
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Membership Settings" subtitle="Configure membership validity and renewal fees.">
      <Flash flash={flash} />
      {!f ? <p className="muted">Loading…</p> : (
        <form className="st-form" onSubmit={save}>
          <label>
            <span className="lbl">Membership Validity</span>
            <div className="st-affix suffix">
              <input type="number" min="1" step="1" value={f.membership_validity_days} onChange={set("membership_validity_days")} onWheel={noWheel} required />
              <span className="suf">days</span>
            </div>
            <p className="st-hint">How long a membership stays active after each renewal.</p>
          </label>
          <div className="st-grid2">
            <label>
              <span className="lbl">Renewal Fee</span>
              <div className="st-affix">
                <span className="pre">₹</span>
                <input type="number" min="0" step="0.01" value={f.renewal_fee} onChange={set("renewal_fee")} onWheel={noWheel} required />
              </div>
            </label>
            <label>
              <span className="lbl">Shop Renewal Fee</span>
              <div className="st-affix">
                <span className="pre">₹</span>
                <input type="number" min="0" step="0.01" value={f.shop_renewal_fee} onChange={set("shop_renewal_fee")} onWheel={noWheel} required />
              </div>
            </label>
          </div>
          <div className="st-actions">
            <button type="button" disabled={!dirty || busy} onClick={() => { setF(saved); clear(); }}>Reset</button>
            <button className="primary" disabled={!dirty || busy}>{busy ? "Saving…" : "Save Changes"}</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ Paper Price */
// Price per sheet. Bill Book and Notice prices are worked out from these, so when the paper
// market rate changes the admin just types the new rate here (no code change).
const PAPER_FIELDS = [
  ["standard_original", "Original Paper Price (A4)", "Bill Book original paper and Notice paper, per sheet."],
  ["duplicate", "Duplicate Paper Price (A4)", "Bill Book duplicate paper, per sheet. Added to the original price for Duplicate bill books."],
  ["low_original", "Low Original Paper Price (A4)", "Original paper for Low Print bill books, per sheet."],
  ["legal_original", "Legal Original Paper Price", "Legal size original paper, per sheet."],
  ["legal_duplicate", "Legal Duplicate Paper Price", "Legal size duplicate paper, per sheet."],
];

function PaperPricePanel() {
  const [saved, setSaved] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, ok, fail, clear] = useFlash();

  useEffect(() => {
    api.get("/settings/paper-prices/").then((r) => { setSaved(r.data); setF(r.data); }).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dirty = f && saved && PAPER_FIELDS.some(([k]) => String(f[k]) !== String(saved[k]));

  const save = async (e) => {
    e.preventDefault();
    clear(); setBusy(true);
    try {
      const r = await api.patch("/settings/paper-prices/", f);
      setSaved(r.data); setF(r.data);
      ok("Paper prices updated");
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Paper Price" subtitle="Enter the current paper price per sheet. New bills, orders and quotations use these prices.">
      <Flash flash={flash} />
      {!f ? <p className="muted">Loading…</p> : (
        <form className="st-form" onSubmit={save}>
          <div className="st-grid2">
            {PAPER_FIELDS.map(([key, label, hint]) => (
              <label key={key}>
                <span className="lbl">{label}</span>
                <div className="st-affix">
                  <span className="pre">₹</span>
                  <input type="number" min="0" step="any" value={f[key]} onChange={set(key)} onWheel={noWheel} required />
                </div>
                <p className="st-hint">{hint}</p>
              </label>
            ))}
          </div>
          <p className="st-hint">A5 uses half and A6 a quarter of the A4 price automatically. Bills and orders already saved are not changed.</p>
          <div className="st-actions">
            <button type="button" disabled={!dirty || busy} onClick={() => { setF(saved); clear(); }}>Reset</button>
            <button className="primary" disabled={!dirty || busy}>{busy ? "Saving…" : "Save Changes"}</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- Security */
function SecurityPanel() {
  const blank = { current_password: "", new_password: "", confirm_password: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [flash, ok, fail, clear] = useFlash();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const rules = [
    { text: `At least ${MIN_PASSWORD_LEN} characters`, state: !f.new_password ? "" : f.new_password.length >= MIN_PASSWORD_LEN ? "ok" : "bad" },
    { text: "New password and confirmation match", state: !f.confirm_password ? "" : f.new_password === f.confirm_password ? "ok" : "bad" },
    { text: "Different from the current password", state: !f.new_password || !f.current_password ? "" : f.new_password !== f.current_password ? "ok" : "bad" },
  ];
  const valid = f.current_password && rules.every((r) => r.state === "ok");

  const save = async (e) => {
    e.preventDefault();
    clear(); setBusy(true);
    try {
      await api.post("/settings/admin-password/", f);
      setF(blank);
      ok("Password updated successfully");
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Security" subtitle="Manage your account credentials.">
      <Flash flash={flash} />
      <form className="st-form" onSubmit={save}>
        <h3 style={{ margin: 0 }}>Change Password</h3>
        <PasswordInput label="Current Password" value={f.current_password} onChange={set("current_password")} autoComplete="current-password" required />
        <PasswordInput label="New Password" value={f.new_password} onChange={set("new_password")} autoComplete="new-password" required />
        <PasswordInput label="Confirm New Password" value={f.confirm_password} onChange={set("confirm_password")} autoComplete="new-password" required />
        <ul className="st-req" aria-label="Password requirements">
          {rules.map((r) => (
            <li key={r.text} className={r.state}>
              <span className="tick">{r.state === "ok" ? <Icon name="check" size={12} /> : r.state === "bad" ? <Icon name="close" size={12} /> : null}</span>
              {r.text}
            </li>
          ))}
        </ul>
        <div className="st-actions">
          <button className="primary" disabled={!valid || busy}>{busy ? "Updating…" : "Update Password"}</button>
        </div>
      </form>
    </Panel>
  );
}

/* ----------------------------------------------------------------- Staff */
// add (staff === null) or edit one staff account
const cleanMobile = (v) => {
  let d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2); // pasted as +91 98765 43210
  return d.slice(0, 10);
};

function StaffFormModal({ staff, onClose, onSaved }) {
  const editing = Boolean(staff);
  const [f, setF] = useState({
    name: staff?.name || "",
    phone: staff?.phone || "",
    email: staff?.email || "",
    username: staff?.username || "",
    password: "",
    role: staff?.role || "staff",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const emailRequired = true;               // every account needs an email: the User ID and the password reset link are sent there
  const isAdmin = f.role === "admin";       // only an admin's username is typed in; manager / staff get a generated User ID
  const prefix = f.role === "manager" ? "M" : "S";
  const newSeries = editing && !isAdmin && f.role !== staff.role; // moved to the other series -> a new ID is issued

  const save = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const body = { name: f.name, phone: f.phone, email: f.email.trim(), role: f.role };
      if (isAdmin) body.username = f.username.trim();
      const r = editing
        ? await api.patch(`/settings/staff/${staff.id}/`, body)
        : await api.post("/settings/staff/", { ...body, password: f.password });
      const id = r.data.username;
      onSaved(r.data.staff, editing
        ? (r.data.id_changed ? `${id} updated - new User ID issued` : `${id} updated`)
        : (isAdmin ? "Admin created successfully" : `Staff created successfully - User ID ${id}`));
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <div className="modal-bg">
      <form className="card modal staff-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{editing ? "Edit Staff" : "Add Staff"}</h2>
        {error && <div className="error">{error}</div>}
        <div className="modal-grid">
          <label><span className="lbl">Name</span>
            <input value={f.name} onChange={set("name")} maxLength={100} autoComplete="off" autoFocus />
          </label>
          <label><span className="lbl">Mobile Number</span>
            <input type="tel" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: cleanMobile(e.target.value) })}
              maxLength={12} pattern="[0-9]{10}" title="Enter a 10 digit mobile number" autoComplete="off" />
          </label>
          <label><span className="lbl">Email <span className="req">*</span></span>
            <input type="email" value={f.email} onChange={set("email")} autoComplete="off" placeholder="name@gmail.com" required={emailRequired} />
          </label>
          {isAdmin ? (
            <label><span className="lbl">Username <span className="req">*</span></span>
              <input value={f.username} onChange={set("username")} autoComplete="off" required />
            </label>
          ) : (
            <label><span className="lbl">User ID</span>
              <input value={editing && !newSeries ? staff.username : `Auto-generated (${prefix}0001, ${prefix}0002 …)`} readOnly disabled />
              <small className="st-hint">{newSeries ? "A new User ID is issued when the role changes." : "Used to sign in. Generated automatically."}</small>
            </label>
          )}
          {!editing && (
            <PasswordInput label={<>Password <span className="req">*</span></>} value={f.password} onChange={set("password")} minLength={MIN_PASSWORD_LEN} autoComplete="new-password" required />
          )}
          <label className={editing ? "span2" : ""}><span className="lbl">Role <span className="req">*</span></span>
            <select value={f.role} onChange={set("role")} required>
              {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Add Staff"}</button>
        </div>
      </form>
    </div>
  );
}

function StaffPasswordModal({ staff, onClose, onDone }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.post(`/settings/staff/${staff.id}/password/`, { new_password: pw });
      onDone(`Password updated for ${staff.username}`);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <div className="modal-bg">
      <form className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Change Password</h2>
        <p className="muted" style={{ margin: 0 }}>{staff.username}</p>
        {error && <div className="error">{error}</div>}
        <PasswordInput label="New password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={MIN_PASSWORD_LEN} autoComplete="new-password" required autoFocus />
        <div className="row">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save Password"}</button>
        </div>
      </form>
    </div>
  );
}

function StaffPanel() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(null);   // false = closed, {} = add, staff row = edit
  const [pwFor, setPwFor] = useState(null);
  const [delFor, setDelFor] = useState(null);
  const [menu, setMenu] = useState(null);   // { staff, top, right } for the "more" dropdown
  const [busy, setBusy] = useState(false);
  const [flash, ok, fail, clear] = useFlash();

  const load = () =>
    api.get("/settings/staff/")
      .then((r) => setStaff(r.data.staff))
      .catch(fail)
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh the online dots every minute
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close the "more" dropdown on outside click / scroll / resize
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e) => { if (!e.target.closest(".st-pop") && !e.target.closest(".bh-ico.more")) close(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [menu]);

  const stats = useMemo(() => {
    const members = staff.filter((s) => s.role !== "admin"); // managers + staff
    return { total: members.length, active: members.filter((s) => s.is_active).length, admins: staff.filter((s) => s.role === "admin").length };
  }, [staff]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return staff.filter((s) =>
      (!needle || [s.username, s.name, s.email, s.phone].some((v) => (v || "").toLowerCase().includes(needle))) &&
      (!role || s.role === role) &&
      (!status || (status === "active") === s.is_active));
  }, [staff, q, role, status]);
  const filtered = Boolean(q || role || status);

  const openMenu = (e, s) => {
    if (menu?.staff.id === s.id) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ staff: s, top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  const toggle = async (s) => {
    clear(); setMenu(null);
    try {
      const r = await api.post(`/settings/staff/${s.id}/toggle/`);
      setStaff(r.data.staff);
      ok(`${s.username} ${s.is_active ? "blocked" : "unblocked"}`);
    } catch (err) { fail(err); }
  };

  const remove = async () => {
    clear(); setBusy(true);
    try {
      const r = await api.delete(`/settings/staff/${delFor.id}/`);
      setStaff(r.data.staff);
      ok("Staff deleted successfully");
    } catch (err) { fail(err); }
    setBusy(false); setDelFor(null);
  };

  return (
    <Panel
      title="Staff & Roles"
      subtitle="Manage staff accounts and their access permissions."
      action={<button type="button" className="primary" onClick={() => setForm({})}><Icon name="plus" size={16} /> Add Staff</button>}
    >
      <Flash flash={flash} />

      <div className="st-stats">
        <div className="st-stat"><b>{stats.total}</b><span>Total Staff</span></div>
        <div className="st-stat active"><b>{stats.active}</b><span>Active</span></div>
        <div className="st-stat admins"><b>{stats.admins}</b><span>Administrators</span></div>
      </div>

      <div className="st-filters">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input placeholder="Search name, user ID, mobile or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search staff" />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All status</option><option value="active">Active</option><option value="blocked">Blocked</option>
        </select>
        <button type="button" disabled={!filtered} onClick={() => { setQ(""); setRole(""); setStatus(""); }}>Clear</button>
      </div>

      <div className="st-table-wrap">
        <table className="st-table">
          <thead><tr><th>User ID</th><th>Name</th><th>Contact</th><th>Role</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="st-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="st-empty">{filtered ? "No staff match these filters" : "No staff accounts yet"}</td></tr>}
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="st-user">
                    <span className={`dot ${s.is_online ? "online" : "offline"}`} title={s.is_online ? "Online" : "Offline"} />
                    {s.username}
                    {s.is_self && <span className="st-you">You</span>}
                  </span>
                </td>
                <td>{s.name || <span className="muted">—</span>}</td>
                <td>
                  {s.phone || s.email ? (
                    <div className="st-contact">{s.phone && <span>{s.phone}</span>}{s.email && <span className="muted">{s.email}</span>}</div>
                  ) : <span className="muted">—</span>}
                </td>
                <td><span className={`pill st-role ${s.role}`}>{ROLE_LABEL[s.role] || "Staff"}</span></td>
                <td><span className={`status ${s.is_active ? "completed" : "cancelled"}`}>{s.is_active ? "Active" : "Blocked"}</span></td>
                <td>
                  {s.editable ? (
                    <div className="st-acts">
                      <button type="button" className="bh-ico edit" data-tip="Edit" aria-label={`Edit ${s.username}`} onClick={() => setForm(s)}><Icon name="edit" size={16} /></button>
                      <button type="button" className="bh-ico more" data-tip="More" aria-label={`More actions for ${s.username}`} aria-haspopup="menu" onClick={(e) => openMenu(e, s)}><Icon name="more" size={16} /></button>
                    </div>
                  ) : (
                    <div className="st-acts"><span className="st-locked" title="This is your account — change the password under Security"><Icon name="lock" size={15} /></span></div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu && (
        <div className="st-pop" role="menu" style={{ top: menu.top, right: menu.right }}>
          <button type="button" role="menuitem" onClick={() => { setPwFor(menu.staff); setMenu(null); }}><Icon name="lock" size={16} />Change password</button>
          <button type="button" role="menuitem" onClick={() => toggle(menu.staff)}>
            <Icon name={menu.staff.is_active ? "block" : "unlock"} size={16} />{menu.staff.is_active ? "Block staff" : "Unblock staff"}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setDelFor(menu.staff); setMenu(null); }}><Icon name="trash" size={16} />Delete staff</button>
        </div>
      )}

      {form && (
        <StaffFormModal
          staff={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={(list, msg) => { setStaff(list); setForm(null); ok(msg); }}
        />
      )}
      {pwFor && <StaffPasswordModal staff={pwFor} onClose={() => setPwFor(null)} onDone={(m) => { setPwFor(null); ok(m); }} />}
      {delFor && (
        <div className="modal-bg">
          <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Staff</h2>
            <p style={{ margin: 0 }}>Are you sure you want to delete <strong>{delFor.username}</strong>? This cannot be undone.</p>
            <div className="row">
              <button disabled={busy} onClick={() => setDelFor(null)}>Cancel</button>
              <button className="danger" disabled={busy} onClick={remove}>{busy ? "Please wait…" : "Yes, delete"}</button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- Activity */
const ACTIVITY_PAGE_SIZE = 15; // matches ActivityPagination on the server
// colour of the action pill: good = green, info = blue, bad = red, warn = amber, mute = grey
const ACTION_TONE = {
  create: "good", login: "good", send: "good", whatsapp: "good", unblock: "good",
  update: "info", status: "info", draft: "info", password: "info",
  delete: "bad", cancel: "bad", login_failed: "bad",
  block: "warn", logout: "mute",
};
const fmtWhen = (iso) => {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
};

function ActivityPanel() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({ today: 0, users_today: 0, failed_today: 0 });
  const [options, setOptions] = useState({ users: [], modules: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState(""); // q after a short pause, so we do not call the server on every key
  const [user, setUser] = useState("");
  const [module, setModule] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0); // Refresh button
  const [flash, , fail, clear] = useFlash();

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    api.get("/settings/activity/", { params: { q: search, user, module, date_from: from, date_to: to, page, page_size: ACTIVITY_PAGE_SIZE } })
      .then((r) => {
        if (stale) return;
        clear();
        setRows(r.data.results); setCount(r.data.count);
        setSummary(r.data.summary); setOptions(r.data.filters);
      })
      .catch((err) => {
        if (stale) return;
        // a page that no longer exists (e.g. after the log was cleaned up) -> back to page 1
        if (err?.response?.status === 404 && page > 1) setPage(1); else fail(err);
      })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, user, module, from, to, page, tick]);

  const filtered = Boolean(q || user || module || from || to);
  const pick = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const reset = () => { setQ(""); setSearch(""); setUser(""); setModule(""); setFrom(""); setTo(""); setPage(1); };

  const pages = Math.max(1, Math.ceil(count / ACTIVITY_PAGE_SIZE));
  const first = count ? (page - 1) * ACTIVITY_PAGE_SIZE + 1 : 0;
  const last = Math.min(page * ACTIVITY_PAGE_SIZE, count);

  return (
    <Panel
      title="Activity Log"
      subtitle="See who did what, and when — bills, orders, customers, staff changes and sign-ins."
      action={<button type="button" onClick={() => setTick((n) => n + 1)} disabled={loading}><Icon name="refresh" size={16} /> Refresh</button>}
    >
      <Flash flash={flash} />

      <div className="st-stats">
        <div className="st-stat"><b>{summary.today}</b><span>Activities today</span></div>
        <div className="st-stat active"><b>{summary.users_today}</b><span>Users active today</span></div>
        <div className="st-stat failed"><b>{summary.failed_today}</b><span>Failed sign-ins today</span></div>
      </div>

      <div className="st-filters act-filters">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input placeholder="Search activity, name or bill no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activity" />
        </div>
        <select value={user} onChange={pick(setUser)} aria-label="User">
          <option value="">All users</option>
          {options.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={module} onChange={pick(setModule)} aria-label="Module">
          <option value="">All modules</option>
          {options.modules.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input type="date" value={from} max={to || undefined} onChange={pick(setFrom)} aria-label="From date" />
        <input type="date" value={to} min={from || undefined} onChange={pick(setTo)} aria-label="To date" />
        <button type="button" disabled={!filtered} onClick={reset}>Clear</button>
      </div>

      <div className="st-table-wrap">
        <table className="st-table act-table">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Details</th><th>IP address</th></tr></thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={5} className="st-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="st-empty">{filtered ? "No activity matches these filters" : "No activity recorded yet"}</td></tr>}
            {rows.map((a) => {
              const when = fmtWhen(a.created_at);
              return (
                <tr key={a.id}>
                  <td className="act-when"><b>{when.day}</b><span className="muted">{when.time}</span></td>
                  <td>
                    <span className="st-user">
                      {a.username}
                      {a.role ? <span className={`pill st-role ${a.role}`}>{ROLE_LABEL[a.role] || "Staff"}</span> : <span className="muted act-anon">not signed in</span>}
                    </span>
                  </td>
                  <td>
                    <span className={`act-pill ${ACTION_TONE[a.action] || "mute"}`}>{a.action_label}</span>
                    <span className="act-module muted">{a.module_label}</span>
                  </td>
                  <td className="act-desc">{a.description}</td>
                  <td className="muted nowrap">{a.ip_address || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span className="muted">{count ? `Showing ${first}–${last} of ${count} entries` : "0 entries"}</span>
        {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ Page */
export default function Settings() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();

  if (!user.is_superuser) {
    return (
      <>
        <h1>Settings</h1>
        <div className="card">Only the admin can open Settings.</div>
      </>
    );
  }

  const tab = SECTIONS.some(([k]) => k === sp.get("tab")) ? sp.get("tab") : "membership";

  return (
    <>
      <div className="st-head">
        <h1>Settings</h1>
        <p className="muted">Configure memberships, paper prices, staff accounts, shops, vendors and your security.</p>
      </div>
      <div className="st-layout">
        <nav className="card st-menu" aria-label="Settings menu">
          <div className="st-menu-title">Settings menu</div>
          {SECTIONS.map(([key, label, icon]) => (
            <button key={key} type="button" className={tab === key ? "on" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => setSp({ tab: key })}>
              <Icon name={icon} size={18} />{label}
            </button>
          ))}
        </nav>
        <div>
          {tab === "membership" && <MembershipPanel />}
          {tab === "paper" && <PaperPricePanel />}
          {tab === "staff" && <StaffPanel />}
          {tab === "shops" && <ShopsPanel Panel={Panel} Flash={Flash} useFlash={useFlash} PasswordInput={PasswordInput} />}
          {tab === "vendors" && <VendorsPanel Panel={Panel} Flash={Flash} useFlash={useFlash} PasswordInput={PasswordInput} />}
          {tab === "activity" && <ActivityPanel />}
          {tab === "security" && <SecurityPanel />}
        </div>
      </div>
    </>
  );
}