import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import Pagination from "../components/Pagination";

// Settings > Shop Management (admin only). Opened from Settings.jsx, which passes its shared UI helpers.
// The open screen lives in the URL, so Back / refresh work:
//   /settings?tab=shops                  list
//   /settings?tab=shops&view=add         add form
//   /settings?tab=shops&view=edit&id=3   edit form
//   /settings?tab=shops&view=detail&id=3 read-only details

const PAGE_SIZE = 10; // same default as the server
const MIN_PASSWORD_LEN = 6; // same rule as the server
const SHOP_TYPES = [["retail", "Retail Shop"], ["wholesale", "Wholesale"], ["press", "Printing Press"], ["stationery", "Stationery Shop"], ["other", "Other"]];
const TYPE_LABEL = Object.fromEntries(SHOP_TYPES);

const cleanMobile = (v) => {
  let d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2); // pasted as +91 98765 43210
  return d.slice(0, 10);
};

const BLANK = {
  name: "", owner_name: "", phone: "", email: "", gst_number: "", shop_type: "", address: "",
  username: "", is_active: "true", password_mode: "invite", password: "", portal_access: true, send_email: false, notes: "",
};

const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* ----------------------------------------------------------- small pieces */
// shown after a setup link is created: copy it, or see whether the email went out
function LinkModal({ title, userId, link, message, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const copyId = async () => {
    try { await navigator.clipboard.writeText(userId); setCopiedId(true); } catch { /* clipboard blocked: the ID can still be selected */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* clipboard blocked: the link can still be selected */ }
  };
  return (
    <div className="modal-bg">
      <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {userId && (
          <>
            <p className="muted" style={{ margin: 0 }}>Login User ID (generated automatically) — the shop signs in to the Shop Portal with this.</p>
            <input readOnly value={userId} onFocus={(e) => e.target.select()} aria-label="Shop User ID" style={{ fontWeight: 700, letterSpacing: ".04em" }} />
          </>
        )}
        {message && <p style={{ margin: 0 }}>{message}</p>}
        {link && (
          <>
            <p className="muted" style={{ margin: 0 }}>Password setup link — it works once and expires after a few days. Share it with the shop owner.</p>
            <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Password setup link" />
          </>
        )}
        <div className="row">
          {userId && <button type="button" onClick={copyId}><Icon name={copiedId ? "check" : "link"} size={16} /> {copiedId ? "Copied" : "Copy User ID"}</button>}
          {link && <button type="button" onClick={copy}><Icon name={copied ? "check" : "link"} size={16} /> {copied ? "Copied" : "Copy link"}</button>}
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// reset password / send setup link for an existing shop
function ShopPasswordModal({ shop, PasswordInput, onClose, onDone }) {
  const [mode, setMode] = useState("invite");
  const [pw, setPw] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await api.post(`/settings/shops/${shop.id}/password/`, { mode, new_password: pw, send_email: sendEmail });
      onDone(r.data, mode);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <div className="modal-bg">
      <form className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Shop Password</h2>
        <p className="muted" style={{ margin: 0 }}>{shop.name} · {shop.username}</p>
        {error && <div className="error">{error}</div>}
        <label className="shop-check"><input type="radio" name="pwmode" checked={mode === "invite"} onChange={() => setMode("invite")} /> Create a secure password setup link</label>
        <label className="shop-check"><input type="radio" name="pwmode" checked={mode === "temp"} onChange={() => setMode("temp")} /> Set a temporary password</label>
        {mode === "temp" && (
          <PasswordInput label="Temporary password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={MIN_PASSWORD_LEN} autoComplete="new-password" required autoFocus />
        )}
        {mode === "invite" && (
          <label className="shop-check"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the link to {shop.email}</label>
        )}
        <div className="row">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Please wait…" : mode === "invite" ? "Create link" : "Save Password"}</button>
        </div>
      </form>
    </div>
  );
}

const Field = ({ label, required, children }) => (
  <label><span className="lbl">{label}{required && <> <span className="req">*</span></>}</span>{children}</label>
);

/* -------------------------------------------------------------- the form */
function ShopForm({ id, PasswordInput, onBack, onSaved }) {
  const editing = Boolean(id);
  const [f, setF] = useState(BLANK);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // { link, message, another }
  const top = useRef(null);

  useEffect(() => {
    if (!editing) return;
    api.get(`/settings/shops/${id}/`)
      .then((r) => {
        const s = r.data;
        setF({ ...BLANK, name: s.name, owner_name: s.owner_name, phone: s.phone, email: s.email, gst_number: s.gst_number, shop_type: s.shop_type,
          address: s.address, username: s.username, is_active: String(s.is_active), portal_access: s.portal_access, notes: s.notes });
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  }, [id, editing]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tick = (k) => (e) => setF({ ...f, [k]: e.target.checked });

  const submit = async (another) => {
    setError(""); setBusy(true);
    try {
      const body = {
        name: f.name, owner_name: f.owner_name, phone: f.phone, email: f.email.trim(), gst_number: f.gst_number, shop_type: f.shop_type,
        address: f.address, is_active: f.is_active === "true", portal_access: f.portal_access, notes: f.notes,
      };
      if (editing) {
        await api.patch(`/settings/shops/${id}/`, body);
        onSaved(`Shop ${f.name} updated`);
        return;
      }
      const r = await api.post("/settings/shops/", {
        ...body, password_mode: f.password_mode, password: f.password_mode === "temp" ? f.password : "", send_email: f.send_email,
      });
      const msg = `Shop ${f.name} created`;
      // always shown: the admin needs to see the User ID that was just generated
      setCreated({ userId: r.data.username, link: r.data.setup_link, message: r.data.email_message, another, msg });
    } catch (err) {
      setError(errorText(err));
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally { setBusy(false); }
  };

  const finishCreate = (another, msg) => {
    if (another) { setF(BLANK); top.current?.scrollIntoView({ behavior: "smooth", block: "start" }); onSaved(msg, true); } else onSaved(msg);
  };

  // the button that was pressed decides "save" or "save and add another"
  const submitter = useRef("save");
  const onSubmit = (e) => { e.preventDefault(); submit(submitter.current === "another"); };

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <form className="shop-form" onSubmit={onSubmit} ref={top}>
      <button type="button" className="shop-back" onClick={onBack}><Icon name="arrowLeft" size={16} /> Back to Shop Management</button>
      <div>
        <h3 style={{ margin: 0 }}>{editing ? "Edit Shop" : "Add New Shop"}</h3>
        <p className="muted" style={{ margin: "2px 0 0" }}>{editing ? "Update the shop profile and its portal access." : "Create a shop profile and grant access to the Shop Portal."}</p>
      </div>
      {error && <div className="error">{error}</div>}

      <section className="shop-sec">
        <h4><span className="num">01</span> Business details</h4>
        <div className="st-grid2">
          <Field label="Shop / Business Name" required><input value={f.name} onChange={set("name")} maxLength={150} autoComplete="off" required autoFocus /></Field>
          <Field label="Owner / Contact Person" required><input value={f.owner_name} onChange={set("owner_name")} maxLength={100} autoComplete="off" required /></Field>
          <Field label="Mobile Number" required>
            <input type="tel" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: cleanMobile(e.target.value) })}
              maxLength={12} pattern="[0-9]{10}" title="Enter a 10 digit mobile number" autoComplete="off" required />
          </Field>
          <Field label="Email Address" required><input type="email" value={f.email} onChange={set("email")} autoComplete="off" required /></Field>
          <Field label="GST Number (Optional)">
            <input value={f.gst_number} onChange={(e) => setF({ ...f, gst_number: e.target.value.toUpperCase().slice(0, 15) })} maxLength={15} autoComplete="off" placeholder="e.g. 32ABCDE1234F1Z5" />
          </Field>
          <Field label="Shop Type (Optional)">
            <select value={f.shop_type} onChange={set("shop_type")}>
              <option value="">Select type</option>
              {SHOP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Address"><textarea rows={3} value={f.address} onChange={set("address")} maxLength={500} /></Field>
      </section>

      <section className="shop-sec">
        <h4><span className="num">02</span> Portal login</h4>
        <div className="st-grid2">
          <Field label="User ID">
            <input value={editing ? f.username : ""} placeholder="Generated automatically when you save (e.g. 2026S0001)" readOnly disabled aria-readonly="true" />
          </Field>
          <Field label="Account Status" required>
            <select value={f.is_active} onChange={set("is_active")}><option value="true">Active</option><option value="false">Inactive</option></select>
          </Field>
        </div>

        {!editing && (
          <div className="shop-pw">
            <span className="lbl">Password Setup</span>
            <label className="shop-check"><input type="radio" name="pwmode" checked={f.password_mode === "invite"} onChange={() => setF({ ...f, password_mode: "invite" })} /> Send secure account invitation / password setup link</label>
            <label className="shop-check"><input type="radio" name="pwmode" checked={f.password_mode === "temp"} onChange={() => setF({ ...f, password_mode: "temp" })} /> Set temporary password</label>
            {f.password_mode === "temp" && (
              <div className="shop-pw-input">
                <PasswordInput label="Temporary password" value={f.password} onChange={set("password")} minLength={MIN_PASSWORD_LEN} autoComplete="new-password" required />
              </div>
            )}
          </div>
        )}

        <label className="shop-check"><input type="checkbox" checked={f.portal_access} onChange={tick("portal_access")} /> Allow shop to log in to the Shop Portal</label>
        {!editing && (
          <label className="shop-check"><input type="checkbox" checked={f.send_email} onChange={tick("send_email")} /> Send account details by email (if email delivery is configured)</label>
        )}
        {editing && <p className="st-hint">To reset the password or send a new setup link, use “More” on the shop list.</p>}
      </section>

      <section className="shop-sec">
        <h4><span className="num">03</span> Internal notes (Optional)</h4>
        <textarea rows={3} value={f.notes} onChange={set("notes")} maxLength={1000} aria-label="Internal notes" placeholder="Only visible to admins" />
      </section>

      <div className="shop-bar">
        <button type="button" disabled={busy} onClick={onBack}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => { submitter.current = "save"; }}>{busy ? "Saving…" : editing ? "Save Changes" : "Save Shop"}</button>
        {!editing && <button disabled={busy} onClick={() => { submitter.current = "another"; }}>Save &amp; Add Another</button>}
      </div>

      {created && (
        <LinkModal
          title="Shop created"
          userId={created.userId}
          link={created.link}
          message={created.message}
          onClose={() => { const c = created; setCreated(null); finishCreate(c.another, c.msg); }}
        />
      )}
    </form>
  );
}

/* --------------------------------------------------------------- details */
function ShopDetail({ id, onBack, onEdit }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get(`/settings/shops/${id}/`).then((r) => setS(r.data)).catch((err) => setError(errorText(err)));
  }, [id]);

  const rows = s && [
    ["Shop / Business", s.name], ["Owner / Contact", s.owner_name], ["Mobile", s.phone], ["Email", s.email],
    ["GST Number", s.gst_number || "—"], ["Shop Type", TYPE_LABEL[s.shop_type] || "—"], ["Address", s.address || "—"],
    ["User ID", s.username], ["Portal Access", s.portal_access ? "Enabled" : "Disabled"], ["Account Status", s.is_active ? "Active" : "Inactive"],
    ["Password", s.password_set ? "Set" : "Not set yet (waiting for setup link)"], ["Added On", fmtDate(s.created_at)], ["Internal Notes", s.notes || "—"],
  ];

  return (
    <div className="shop-form">
      <button type="button" className="shop-back" onClick={onBack}><Icon name="arrowLeft" size={16} /> Back to Shop Management</button>
      {error && <div className="error">{error}</div>}
      {!s && !error && <p className="muted">Loading…</p>}
      {s && (
        <>
          <div className="between row">
            <h3 style={{ margin: 0 }}>{s.name}</h3>
            <button type="button" className="primary" onClick={onEdit}><Icon name="edit" size={16} /> Edit</button>
          </div>
          <dl className="shop-dl">
            {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ list */
export default function ShopsPanel({ Panel, Flash, useFlash, PasswordInput }) {
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") || "list";
  const id = sp.get("id");
  const go = (params) => setSp({ tab: "shops", ...params });

  const [flash, ok, fail, clear] = useFlash();

  const [data, setData] = useState({ results: [], count: 0, pages: 1, stats: { total: 0, active: 0, inactive: 0, new_this_month: 0 } });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState(""); // q after a short pause
  const [status, setStatus] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0); // reload after an action
  const [menu, setMenu] = useState(null); // { shop, top, right }
  const [pwFor, setPwFor] = useState(null);
  const [delFor, setDelFor] = useState(null);
  const [link, setLink] = useState(null); // { title, link, message }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (view !== "list") return;
    let stale = false;
    setLoading(true);
    api.get("/settings/shops/", { params: { q: search, status, account, page, page_size: PAGE_SIZE } })
      .then((r) => { if (!stale) { setData(r.data); if (r.data.page !== page) setPage(r.data.page); } })
      .catch((err) => { if (!stale) fail(err); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search, status, account, page, tick]);

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

  const filtered = Boolean(q || status || account);
  const reset = () => { setQ(""); setSearch(""); setStatus(""); setAccount(""); setPage(1); };
  const pick = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const openMenu = (e, s) => {
    if (menu?.shop.id === s.id) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ shop: s, top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  const toggleStatus = async (s) => {
    clear(); setMenu(null);
    try {
      const r = await api.post(`/settings/shops/${s.id}/toggle/`);
      ok(`${s.name} ${r.data.is_active ? "activated" : "deactivated"}`); setTick((n) => n + 1);
    } catch (err) { fail(err); }
  };

  const togglePortal = async (s) => {
    clear(); setMenu(null);
    try {
      const r = await api.post(`/settings/shops/${s.id}/portal/`);
      ok(`Portal access ${r.data.portal_access ? "enabled" : "disabled"} for ${s.name}`); setTick((n) => n + 1);
    } catch (err) { fail(err); }
  };

  const remove = async () => {
    clear(); setBusy(true);
    try {
      await api.delete(`/settings/shops/${delFor.id}/`);
      ok("Shop deleted successfully"); setTick((n) => n + 1);
    } catch (err) { fail(err); }
    setBusy(false); setDelFor(null);
  };

  /* ---- add / edit / detail screens */
  if (view === "add" || view === "edit") {
    return (
      <Panel title="Shop Management" subtitle="Manage external printing shops and their portal access.">
        <Flash flash={flash} />
        <ShopForm
          key={view + (id || "")}
          id={view === "edit" ? id : null}
          PasswordInput={PasswordInput}
          onBack={() => go({})}
          onSaved={(msg, stay) => { ok(msg); if (!stay) go({}); }}
        />
      </Panel>
    );
  }
  if (view === "detail") {
    return (
      <Panel title="Shop Management" subtitle="Manage external printing shops and their portal access.">
        <ShopDetail id={id} onBack={() => go({})} onEdit={() => go({ view: "edit", id })} />
      </Panel>
    );
  }

  /* ---- list */
  const { results, count, pages, stats } = data;
  const first = count ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, count);

  return (
    <Panel
      title="Shop Management"
      subtitle="Manage external printing shops and their portal access."
      action={<button type="button" className="primary" onClick={() => { clear(); go({ view: "add" }); }}><Icon name="plus" size={16} /> Add New Shop</button>}
    >
      <Flash flash={flash} />

      <div className="st-stats shop-stats">
        <div className="st-stat"><b>{stats.total}</b><span>Total Shops</span></div>
        <div className="st-stat active"><b>{stats.active}</b><span>Active Shops</span></div>
        <div className="st-stat failed"><b>{stats.inactive}</b><span>Inactive Shops</span></div>
        <div className="st-stat admins"><b>{stats.new_this_month}</b><span>New This Month</span></div>
      </div>

      <div className="st-filters shop-filters">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input placeholder="Search shop name, owner, mobile, email or User ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shops" />
        </div>
        <select value={status} onChange={pick(setStatus)} aria-label="Status">
          <option value="">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <select value={account} onChange={pick(setAccount)} aria-label="Portal access">
          <option value="">All Accounts</option><option value="enabled">Portal enabled</option><option value="disabled">Portal disabled</option>
        </select>
        <button type="button" disabled={!filtered} onClick={reset}>Reset Filters</button>
      </div>

      <div className="between row">
        <b className="shop-dir">Shop Directory</b>
        <span className="muted">Showing {count} shop{count === 1 ? "" : "s"}</span>
      </div>

      <div className="st-table-wrap">
        <table className="st-table shop-table">
          <thead><tr><th>Shop / Business</th><th>Contact</th><th>User ID</th><th>Portal Access</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
          <tbody>
            {loading && results.length === 0 && <tr><td colSpan={6} className="st-empty">Loading…</td></tr>}
            {!loading && results.length === 0 && <tr><td colSpan={6} className="st-empty">{filtered ? "No shops match these filters" : "No shops added yet"}</td></tr>}
            {results.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="st-contact"><b>{s.name}</b>{s.shop_type_label && <span className="muted">{s.shop_type_label}</span>}</div>
                </td>
                <td><div className="st-contact"><span>{s.owner_name}</span><span className="muted">{s.phone}</span></div></td>
                <td><div className="st-contact"><span>{s.username}</span><span className="muted">{s.email}</span></div></td>
                <td><span className={`pill ${s.portal_access ? "green" : ""}`}>{s.portal_access ? "Enabled" : "Disabled"}</span></td>
                <td><span className={`status ${s.is_active ? "completed" : "cancelled"}`}>● {s.is_active ? "Active" : "Inactive"}</span></td>
                <td>
                  <div className="st-acts">
                    <button type="button" className="bh-ico view" data-tip="View" aria-label={`View ${s.name}`} onClick={() => go({ view: "detail", id: s.id })}><Icon name="eye" size={16} /></button>
                    <button type="button" className="bh-ico edit" data-tip="Edit" aria-label={`Edit ${s.name}`} onClick={() => go({ view: "edit", id: s.id })}><Icon name="edit" size={16} /></button>
                    <button type="button" className="bh-ico more" data-tip="More" aria-label={`More actions for ${s.name}`} aria-haspopup="menu" onClick={(e) => openMenu(e, s)}><Icon name="more" size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span className="muted">{count ? `Showing ${first}–${last} of ${count} shop${count === 1 ? "" : "s"}` : "0 shops"}</span>
        {pages > 1 && <Pagination page={page} pages={pages} onChange={setPage} />}
      </div>

      {menu && (
        <div className="st-pop" role="menu" style={{ top: menu.top, right: menu.right }}>
          <button type="button" role="menuitem" onClick={() => { setPwFor(menu.shop); setMenu(null); }}><Icon name="lock" size={16} />Password / setup link</button>
          <button type="button" role="menuitem" onClick={() => togglePortal(menu.shop)}>
            <Icon name={menu.shop.portal_access ? "block" : "unlock"} size={16} />{menu.shop.portal_access ? "Disable portal access" : "Enable portal access"}
          </button>
          <button type="button" role="menuitem" onClick={() => toggleStatus(menu.shop)}>
            <Icon name={menu.shop.is_active ? "block" : "check"} size={16} />{menu.shop.is_active ? "Deactivate account" : "Activate account"}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setDelFor(menu.shop); setMenu(null); }}><Icon name="trash" size={16} />Delete shop</button>
        </div>
      )}

      {pwFor && (
        <ShopPasswordModal
          shop={pwFor}
          PasswordInput={PasswordInput}
          onClose={() => setPwFor(null)}
          onDone={(r, mode) => {
            const shop = pwFor;
            setPwFor(null); setTick((n) => n + 1);
            if (mode === "invite") setLink({ title: "Password setup link", link: r.setup_link, message: r.email_message });
            else ok(`Temporary password set for ${shop.name}`);
          }}
        />
      )}
      {link && <LinkModal title={link.title} link={link.link} message={link.message} onClose={() => setLink(null)} />}
      {delFor && (
        <div className="modal-bg">
          <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Shop</h2>
            <p style={{ margin: 0 }}>Are you sure you want to delete <strong>{delFor.name}</strong>? Its portal login will be removed too. This cannot be undone.</p>
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