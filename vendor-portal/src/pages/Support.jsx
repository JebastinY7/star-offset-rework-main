import { useEffect, useState } from "react";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import "../support.css";

const MAX = 1500;
const MIN = 10; // same limits as the server
const digits = (v) => (v || "").replace(/\D/g, "");

// Pre-filled answers. Payments are NOT made inside this portal - Star Offset pays the vendor by mobile transfer or cash.
const FAQ = [
  {
    group: "Orders",
    ico: "box",
    items: [
      ["Where do I see the work given to me?", "Open Assigned Work. Every job Star Offset gives you appears there with its order no., work type, quantity and due date. Click View to see the full details and artwork files."],
      ["How do I accept a job and start it?", "Open the job with View, accept it, then move it to In Progress when you begin printing. Keep the status updated so Star Offset always knows where the job stands."],
      ["What should I do when the job is finished?", "Mark it Ready for Pickup from the job page. Star Offset will collect it (or arrange delivery) and then close it as Completed."],
      ["A job is showing Overdue. What now?", "Overdue means the due date has passed and the job is not finished yet. Please call or WhatsApp us so we can agree on a new date, and update the job status once it is done."],
      ["I cannot open or download the artwork file.", "Use the Related job option in the form on this page, choose Artwork or files as the topic and tell us which order no. is affected. We will resend the file."],
    ],
  },
  {
    group: "Payments",
    ico: "wallet",
    items: [
      ["Is there online payment in this portal?", "No. The portal does not process payments. Star Offset pays you directly to your registered mobile number or in cash."],
      ["When and how will I be paid?", "Once a job is Completed, Star Offset pays the agreed price by mobile transfer or cash. For the exact payment timing of a particular order, call us or send a message with that order no."],
      ["Where can I see the price of a job?", "The price is shown on the job details page. For new work, the Price Requests page lets you send your price for the whole job, and Star Offset replies by accepting or declining it."],
      ["I have not received my payment yet.", "Choose Price request or payment as the topic, select the order in Related job and send the message, or call us directly. Please mention the date the job was completed."],
      ["I want to change the price I quoted.", "You can send a new price from Price Requests while the request is still open. After Star Offset has accepted it, call us to discuss any change."],
    ],
  },
];

export default function Support() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [f, setF] = useState({ topic: "", job_id: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState("0-0");

  useEffect(() => {
    const ctrl = new AbortController();
    api.get("/vendor/support/", { signal: ctrl.signal })
      .then((r) => setInfo(r.data))
      .catch((e) => { if (e.code !== "ERR_CANCELED") setLoadError(errorText(e)); });
    return () => ctrl.abort();
  }, []);

  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setDone(false); };
  const c = info?.contact;

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setDone(false);
    if (!f.topic) return setError("Choose what your message is about.");
    if (f.message.trim().length < MIN) return setError(`Please write a little more (at least ${MIN} characters).`);
    setBusy(true);
    try {
      await api.post("/vendor/support/", { topic: f.topic, message: f.message.trim(), job_id: f.job_id || null });
      setF({ topic: "", job_id: "", message: "" });
      setDone(true);
    } catch (err) { setError(errorText(err)); }
    setBusy(false);
  };

  const WAYS = c ? [
    c.phone && { ico: "phone", label: "Call us", value: c.phone, href: `tel:${c.phone.replace(/\s/g, "")}`, cta: "Call now" },
    c.whatsapp && { ico: "whatsapp", label: "WhatsApp", value: c.whatsapp, href: `https://wa.me/${digits(c.whatsapp)}`, cta: "Open chat", ext: true },
    c.email && { ico: "mail", label: "Email", value: c.email, href: `mailto:${c.email}`, cta: "Send email" },
  ].filter(Boolean) : [];

  return (
    <div className="aw">
      <div className="aw-head">
        <h1>Contact Support</h1>
        <p>Need help with a job, a price request or a payment? Call, email or send us a message.</p>
      </div>

      {loadError && <div className="alert error" role="alert"><span>{loadError}</span></div>}

      <section className="vd-card sp-top" aria-label="Contact details">
        {!c && !loadError && <p className="muted">Loading…</p>}
        {WAYS.length > 0 && (
          <div className="sp-ways">
            {WAYS.map((w) => (
              <a key={w.label} className="sp-way" href={w.href} {...(w.ext ? { target: "_blank", rel: "noreferrer" } : {})}>
                <span className={`sp-way-ico ${w.ico}`}><Icon name={w.ico} size={24} /></span>
                <span className="sp-way-text"><small>{w.label}</small><b>{w.value}</b></span>
                <span className="sp-way-cta">{w.cta}</span>
              </a>
            ))}
          </div>
        )}
        {c && (c.address || c.hours) && (
          <dl className="sp-info">
            {c.address && <div><dt><Icon name="pin" size={18} /> Address</dt><dd>{c.address}</dd></div>}
            {c.hours && <div><dt><Icon name="clock" size={18} /> Working hours</dt><dd>{c.hours}</dd></div>}
          </dl>
        )}
      </section>

      <div className="sp-grid">
        <section className="vd-card sp-card">
          <h2>Send us a message</h2>
          <p className="muted sp-sub">We will reply to the email address on your account.</p>
          {error && <div className="alert error" role="alert"><span>{error}</span></div>}
          {done && <div className="alert ok" role="status">Your message has been sent. We will get back to you soon.</div>}
          <form className="sp-form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="sp-topic">What is it about?</label>
              <select id="sp-topic" value={f.topic} onChange={set("topic")}>
                <option value="">Choose a topic…</option>
                {(info?.topics || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sp-job">Related order <span className="muted">(optional)</span></label>
              <select id="sp-job" value={f.job_id} onChange={set("job_id")}>
                <option value="">Not about a specific order</option>
                {(info?.jobs || []).map((j) => <option key={j.id} value={j.id}>{j.order_no} · {j.status}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sp-msg">Your message</label>
              <textarea id="sp-msg" rows={6} maxLength={MAX} value={f.message} onChange={set("message")} placeholder="Tell us how we can help…" />
              <small className="sp-count">{f.message.length}/{MAX}</small>
            </div>
            <div className="sp-actions"><button type="submit" className="aw-btn accent" disabled={busy}>{busy ? "Sending…" : "Send Message"}</button></div>
          </form>
        </section>

        <section className="vd-card sp-card">
          <h2>Quick answers</h2>
          <p className="muted sp-sub">Common questions about orders and payments.</p>
          {FAQ.map((g, gi) => (
            <div className="sp-faq-group" key={g.group}>
              <h3><Icon name={g.ico} size={18} /> {g.group}</h3>
              {g.items.map(([q, a], qi) => {
                const id = `${gi}-${qi}`;
                const isOpen = open === id;
                return (
                  <div className={`sp-faq${isOpen ? " open" : ""}`} key={id}>
                    <button type="button" className="sp-faq-q" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : id)}>
                      <span>{q}</span><Icon name="chevron" size={16} className="sp-faq-chev" />
                    </button>
                    {isOpen && <p className="sp-faq-a">{a}</p>}
                  </div>
                );
              })}
            </div>
          ))}
          <p className="sp-faq-foot muted">Cannot find your answer? Use the form or call us.</p>
        </section>
      </div>
    </div>
  );
}
