import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { errorText } from "../api";
import Icon from "../components/Icon";
import "../profile.css";
import "../support.css";

const MAX = 1500;
const FAQ = [
  { q: "How do I place a printing order?", a: "Open Place an Order, choose a service, select its options and quantity, attach your artwork and press Add to Cart. Repeat for each item, then open the Order Cart, choose how to pay and press the pay button to place the order." },
  { q: "Is the price final?", a: "Yes. The price shown in your Order Cart is the final price based on your shop rates, and that is the amount you pay. If an item shows Price to be confirmed, it has no final price yet and cannot be ordered until pricing is available. Contact us and we will help." },
  { q: "How do I pay for an order?", a: "You pay when you place the order, either from your wallet or online. Wallet is used when your balance covers the total. You can also choose Pay online (UPI, cards or net banking) through Razorpay. An online payment is recorded in your wallet history and applied to the order." },
  { q: "My online payment went through but the order was not placed. What now?", a: "Your payment is safe. It is added to your wallet. Open the Order Cart, choose Pay from wallet and place the order again. Nothing is charged twice. If it still fails, message us with the payment details." },
  { q: "How does my wallet work?", a: "Your wallet holds money you add in advance. Order totals are deducted from the balance when you place an order, and the balance is always visible in the top bar. Every credit and debit appears in your transaction history on the My Wallet page." },
  { q: "How do I add money to my wallet?", a: "Open My Wallet, enter an amount (minimum ₹100, maximum ₹1,00,000 per top-up) or pick a quick amount, then press Add Money with Razorpay. Pay with UPI, cards or net banking. The wallet is credited only after the payment is verified." },
  { q: "My wallet was not credited after paying. What should I do?", a: "Wait a minute and press refresh on the My Wallet page. If the amount is still missing, send us a message with the topic Payment and the payment time and amount, and we will check it." },
  { q: "How do I send my artwork files?", a: "Attach them to each item before adding it to the cart. They are sent with your order automatically (up to 20 files and 20 MB in total per order). If a file is too large, send it by WhatsApp or email and mention your order number." },
  { q: "How can I change my shop details?", a: "You can update them yourself. Open Shop Profile and press Edit Details to change your contact person, mobile number, email, GST number and shop address. You can also change your password from Change Password." },
  { q: "Can I change my shop name, shop ID or account status?", a: "These cannot be changed from the portal. Send us a message using the form here, or call us, and Star Offset will help." },
];

export default function ContactSupport() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ topic: "", order_id: "", message: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    api.get("/shop/support/").then((r) => setInfo(r.data)).catch((e) => setLoadError(errorText(e)));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const valid = form.topic && form.message.trim().length >= 10;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || sending) return;
    setError("");
    setSending(true);
    try {
      await api.post("/shop/support/", form);
      setSent(true);
      setForm({ topic: "", order_id: "", message: "" });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const c = info?.contact;
  const digits = (v) => v.replace(/\D/g, "");
  const cards = c && [
    { icon: "phone", title: "Call Us", value: c.phone, href: `tel:${c.phone.replace(/[^\d+]/g, "")}`, action: "Call now" },
    { icon: "whatsapp", title: "WhatsApp", value: c.whatsapp, href: `https://wa.me/${digits(c.whatsapp)}`, action: "Start chat", external: true },
    { icon: "mail", title: "Email Us", value: c.email, href: `mailto:${c.email}`, action: "Send email" },
    { icon: "pin", title: "Visit Us", value: c.address, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`, action: "Get directions", external: true },
  ];

  return (
    <div className="sp sup">
      <div>
        <h1>Contact Support</h1>
        <p className="muted">Questions about an order, prices or your account? Star Offset Printing is happy to help.</p>
      </div>

      {loadError && <p className="alert error">{loadError}</p>}

      {cards && (
        <section className="sup-cards">
          {cards.map((x) => (
            <a key={x.title} className="card sup-card" href={x.href} {...(x.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              <span className={`sp-ico ${x.icon}`}><Icon name={x.icon} size={22} /></span>
              <span className="sup-title">{x.title}</span>
              <span className="sup-value">{x.value}</span>
              <span className="sup-action">{x.action} <Icon name="arrow" size={14} /></span>
            </a>
          ))}
        </section>
      )}
      {c?.hours && <p className="sup-hours"><Icon name="history" size={16} /> {c.hours}</p>}

      <div className="sp-grid sup-grid">
        <section className="card sp-card">
          <div className="sp-head"><div><h2>Send us a message</h2><p className="muted small">We will reply to the email address on your shop profile.</p></div></div>

          {sent ? (
            <div className="sup-sent">
              <span className="sup-sent-icon"><Icon name="check" size={26} /></span>
              <h3>Message sent</h3>
              <p className="muted">Thank you. Star Offset will get back to you soon. For anything urgent, please call us.</p>
              <button type="button" className="sp-btn" onClick={() => setSent(false)}>Send another message</button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="sup-fields">
                <div className="sp-field">
                  <label htmlFor="sup-topic">What is it about?</label>
                  <div className="sp-input">
                    <Icon name="info" size={17} />
                    <select id="sup-topic" value={form.topic} onChange={set("topic")}>
                      <option value="">Select a topic</option>
                      {(info?.topics || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="sp-field">
                  <label htmlFor="sup-order">Related order <span className="muted">(optional)</span></label>
                  <div className="sp-input">
                    <Icon name="quote" size={17} />
                    <select id="sup-order" value={form.order_id} onChange={set("order_id")}>
                      <option value="">{info?.orders?.length ? "Not about a specific order" : "No orders yet"}</option>
                      {(info?.orders || []).map((o) => <option key={o.id} value={o.id}>{o.order_no}</option>)}
                    </select>
                  </div>
                </div>
                <div className="sp-field wide">
                  <label htmlFor="sup-message">Your message</label>
                  <div className="sp-input">
                    <Icon name="chat" size={17} />
                    <textarea id="sup-message" rows={6} maxLength={MAX} value={form.message} onChange={set("message")} placeholder="Tell us how we can help…" />
                  </div>
                  <small className="muted sup-count">{form.message.length} / {MAX}</small>
                </div>
              </div>
              {error && <p className="alert error">{error}</p>}
              <div className="sp-actions">
                <button type="submit" className="primary" disabled={!valid || sending}>{sending ? "Sending…" : "Send Message"}</button>
              </div>
            </form>
          )}
        </section>

        <section className="card sp-card sup-faq">
          <div className="sp-head"><div><h2>Quick answers</h2><p className="muted small">Orders, payments, wallet and your shop details.</p></div></div>
          {FAQ.map((f, i) => (
            <div className={`sup-q${open === i ? " open" : ""}`} key={f.q}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{f.q}</span><Icon name="chevron" size={18} />
              </button>
              {open === i && <p>{f.a}</p>}
            </div>
          ))}
          <div className="sup-links">
            <Link to="/wallet" className="sup-more">My wallet <Icon name="arrow" size={14} /></Link>
            <Link to="/profile" className="sup-more">Shop profile <Icon name="arrow" size={14} /></Link>
            <Link to="/orders" className="sup-more">View my orders <Icon name="arrow" size={14} /></Link>
          </div>
        </section>
      </div>
    </div>
  );
}