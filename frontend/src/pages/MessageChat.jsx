import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api, { errorText } from "../api";
import WaIcon, { Tick } from "../components/Waicons";
import { avatarColor, dayLabel, fmtClock, fmtListTime, initials, previewText, sameDay } from "../lib/whatsapp";
import "./messages.css";

// One WhatsApp conversation = /messages/:phone  (WhatsApp-style two-pane screen)
//  - left: chat list (hidden on small screens)
//  - right: thread. Loads once, then polls for newer messages every 5 seconds.
//  - composer: free text inside the 24-hour window, approved templates any time.
// Opening the chat marks the customer's messages as read (done by the API).

const WINDOW_MS = 24 * 3600 * 1000;

function Avatar({ name, phone, className = "" }) {
  const letters = initials(name);
  return (
    <span className={`wx-avatar ${className}${letters ? "" : " none"}`} style={{ background: avatarColor(phone) }}>
      {letters || <WaIcon name="user" size={18} />}
    </span>
  );
}

// ------------------------------------------------------------ left list
function ChatList({ activePhone, backQuery }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    api.get("/messages/", { params: { page_size: 100, ...(q.trim() ? { q: q.trim() } : {}) } })
      .then((r) => { setRows(r.data.results); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [q]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <aside className="wx-side">
      <div className="wx-side-head">
        <h3>Chats</h3>
        <div className="search-box">
          <WaIcon name="search" size={16} />
          <input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="wx-list">
        {loaded && rows.length === 0 && <div className="wx-side-empty">No chats found</div>}
        {rows.map((c) => {
          const active = c.phone === activePhone;
          const unread = active ? 0 : c.unread;
          return (
            <Link key={c.phone} to={`/messages/${c.phone}${backQuery ? `?${backQuery}` : ""}`}
              className={`wx-item${active ? " on" : ""}${unread ? " has-new" : ""}`}>
              <Avatar name={c.customer_name} phone={c.phone} />
              <div className="wx-item-main">
                <div className="wx-item-top">
                  <span className="wx-item-name">{c.customer_name || c.phone}</span>
                  <span className="wx-item-time">{fmtListTime(c.last_message.created_at)}</span>
                </div>
                <div className="wx-item-bot">
                  <span className="wx-item-prev">{previewText(c.last_message)}</span>
                  {unread > 0 && <span className="wx-count">{unread}</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}

// -------------------------------------------------------------- bubbles
function Media({ m }) {
  const { message_type: type, media_url: url, media_filename: file } = m;

  if (type === "image" || type === "sticker") {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img className="wx-img" src={url} alt={file || "Image"} />
      </a>
    ) : <div className="wx-missing">Image unavailable</div>;
  }
  if (type === "video") {
    return url ? <video className="wx-img" src={url} controls /> : <div className="wx-missing">Video unavailable</div>;
  }
  if (type === "audio") {
    return url ? <audio src={url} controls /> : <div className="wx-missing">Audio unavailable</div>;
  }
  if (type === "document") {
    return (
      <div className="wx-doc">
        <span className="wx-doc-ico"><WaIcon name="file" size={20} /></span>
        <div>
          <strong>{file || "Document"}</strong>
          {url
            ? <a href={url} target="_blank" rel="noopener noreferrer">Open / Download</a>
            : <span className="wx-missing">File unavailable</span>}
        </div>
      </div>
    );
  }
  return null;
}

function Bubble({ m, first }) {
  const mine = m.direction === "out";
  const mediaOnly = !m.body && ["image", "video", "sticker"].includes(m.message_type) && !!m.media_url;
  return (
    <div className={`wx-msg ${mine ? "out" : "in"}${first ? " first" : ""}`}>
      <div className={`wx-bubble${mediaOnly ? " media-only" : ""}`}>
        {m.message_type === "template" && (
          <div className="wx-tag"><WaIcon name="template" size={13} /> Template message</div>
        )}
        <Media m={m} />
        {m.body && <div className="wx-text">{m.body}</div>}
        <span className="wx-meta">{fmtClock(m.created_at)}{mine && <Tick />}</span>
      </div>
    </div>
  );
}

// keyed by phone, so opening a different chat starts with fresh state
export default function MessageChat() {
  const { phone } = useParams();
  return <Chat key={phone} phone={phone} />;
}

function Chat({ phone }) {
  const [sp] = useSearchParams();
  const backQuery = sp.toString();

  const [msgs, setMsgs] = useState([]);
  const [info, setInfo] = useState({ customer_name: null, window_open: true });
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());

  const [mode, setMode] = useState("text"); // text | template
  const [templates, setTemplates] = useState([]);
  const [tplName, setTplName] = useState("");
  const [vals, setVals] = useState({});
  const [preview, setPreview] = useState(false);

  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);

  const box = useRef(null);
  const area = useRef(null);
  const lastId = useRef(0);
  const stick = useRef(true); // keep scrolled to the bottom unless the user scrolled up to read

  // add messages we don't already have (a sent message can also arrive through polling)
  const append = useCallback((list) => {
    setMsgs((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      const add = list.filter((m) => !seen.has(m.id));
      return add.length ? [...cur, ...add] : cur;
    });
  }, []);

  useEffect(() => {
    lastId.current = msgs.reduce((mx, m) => Math.max(mx, m.id), 0);
  }, [msgs]);

  // first load
  useEffect(() => {
    let alive = true;
    api.get(`/messages/chat/${phone}/`)
      .then((r) => {
        if (!alive) return;
        setMsgs(r.data.messages);
        setInfo({ customer_name: r.data.customer_name, window_open: r.data.window_open });
      })
      .catch((e) => alive && setErr(errorText(e)))
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [phone]);

  // approved templates (customer name / latest order come prefilled)
  useEffect(() => {
    let alive = true;
    api.get("/messages/templates/", { params: { phone } })
      .then((r) => alive && setTemplates(r.data.templates))
      .catch(() => {});
    return () => { alive = false; };
  }, [phone]);

  // poll for new messages
  useEffect(() => {
    if (!loaded) return;
    const t = setInterval(() => {
      api.get(`/messages/chat/${phone}/`, { params: { after: lastId.current } })
        .then((r) => {
          setInfo({ customer_name: r.data.customer_name, window_open: r.data.window_open });
          if (r.data.messages.length) {
            if (!stick.current) {
              setNewBelow((n) => n + r.data.messages.filter((m) => m.direction === "in").length);
            }
            append(r.data.messages);
          }
        })
        .catch(() => {}); // a missed poll is fine, the next one will catch up
    }, 5000);
    return () => clearInterval(t);
  }, [phone, loaded, append]);

  // keeps the "xh ym left" label fresh and closes the window on time
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs, loaded]);

  const onScroll = () => {
    const el = box.current;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAtBottom(near);
    if (near) setNewBelow(0);
  };

  const toBottom = () => {
    stick.current = true;
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  };

  // ---- 24-hour window
  let lastIn = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].direction === "in") { lastIn = msgs[i]; break; }
  }
  const msLeft = lastIn ? WINDOW_MS - (now - new Date(lastIn.created_at).getTime()) : 0;
  const windowOpen = !loaded || (info.window_open && msLeft > 0);
  const leftLabel = (() => {
    const mins = Math.max(0, Math.floor(msLeft / 60000));
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
  })();
  const tplMode = !windowOpen || mode === "template";

  // ---- free text
  const send = async () => {
    const body = text.trim();
    if (!body || sending || !windowOpen) return;
    setSending(true); setErr("");
    try {
      const r = await api.post(`/messages/chat/${phone}/`, { message: body });
      stick.current = true;
      append([r.data]);
      setText("");
      if (area.current) area.current.style.height = "auto";
    } catch (e) {
      setErr(errorText(e));
    }
    setSending(false);
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const onType = (e) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  // ---- templates
  const tpl = templates.find((t) => t.name === tplName);

  const pick = (name) => {
    const t = templates.find((x) => x.name === name);
    setTplName(name);
    setPreview(false);
    setVals(t ? Object.fromEntries(t.params.map((p) => [p.key, p.value || ""])) : {});
  };

  const previewBody = tpl
    ? tpl.params.reduce((s, p, i) => s.split(`{{${i + 1}}}`).join((vals[p.key] || "").trim() || `[${p.label}]`), tpl.body)
    : "";
  const tplReady = !!tpl && tpl.params.every((p) => (vals[p.key] || "").trim());

  const sendTemplate = async () => {
    if (!tplReady || sending) return;
    setSending(true); setErr("");
    try {
      const r = await api.post(`/messages/chat/${phone}/template/`, { template: tplName, params: vals });
      stick.current = true;
      append([r.data]);
      setTplName(""); setVals({}); setPreview(false);
      if (windowOpen) setMode("text");
    } catch (e) {
      setErr(errorText(e));
    }
    setSending(false);
  };

  const name = info.customer_name;

  return (
    <div className="wx-app">
      <ChatList activePhone={phone} backQuery={backQuery} />

      <section className="wx-chat">
        <header className="wx-chat-head">
          <Link to={`/messages${backQuery ? `?${backQuery}` : ""}`} className="wx-back" title="Back to messages">
            <WaIcon name="back" size={22} />
          </Link>
          <Avatar name={name} phone={phone} className="sm" />
          <div className="wx-chat-info">
            <div className="wx-chat-title">{name || phone}</div>
            <div className="wx-chat-sub">{name ? phone : "Customer conversation"}</div>
          </div>
          {loaded && (
            <span className={`wx-window${windowOpen ? "" : " closed"}`}>
              {windowOpen ? `Reply window · ${leftLabel}` : "Reply window closed"}
            </span>
          )}
        </header>

        <div className="wx-scroll" ref={box} onScroll={onScroll}>
          {!loaded && <div className="wx-state">Loading…</div>}
          {loaded && msgs.length === 0 && <div className="wx-state">No messages yet</div>}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || !sameDay(prev.created_at, m.created_at);
            const first = newDay || prev.direction !== m.direction;
            return (
              <Fragment key={m.id}>
                {newDay && <div className="wx-day">{dayLabel(m.created_at)}</div>}
                <Bubble m={m} first={first} />
              </Fragment>
            );
          })}
        </div>

        {loaded && !atBottom && (
          <button type="button" className="wx-down" onClick={toBottom} title="Go to latest message">
            <WaIcon name="down" size={22} />
            {newBelow > 0 && <i>{newBelow}</i>}
          </button>
        )}

        {err && <div className="wx-err">{err}</div>}

        {loaded && !windowOpen && (
          <div className="wx-warn">
            <WaIcon name="alert" size={18} />
            <div>
              <strong>24-hour free-text reply window has closed.</strong>
              Use an approved WhatsApp template to contact the customer.
            </div>
          </div>
        )}

        {tplMode ? (
          <div className="wx-tpl">
            <div className="wx-tpl-bar">
              <select value={tplName} onChange={(e) => pick(e.target.value)} disabled={sending}>
                <option value="">Choose template</option>
                {templates.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
              </select>
              <button type="button" disabled={!tpl} onClick={() => setPreview((v) => !v)}>
                <WaIcon name="eye" size={16} /> {preview ? "Hide preview" : "Preview message"}
              </button>
              <button type="button" className="wx-tpl-send" disabled={!tplReady || sending} onClick={sendTemplate}>
                <WaIcon name="send" size={16} /> {sending ? "Sending…" : "Send"}
              </button>
            </div>

            {tpl && (
              <div className="wx-tpl-params">
                {tpl.params.map((p) => (
                  <div key={p.key}>
                    <label htmlFor={`wxp-${p.key}`}>{p.label}</label>
                    <input id={`wxp-${p.key}`} value={vals[p.key] || ""} maxLength={1000}
                      onChange={(e) => setVals((v) => ({ ...v, [p.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            )}

            {tpl && preview && (
              <div className="wx-preview">
                <small>Preview</small>
                <div className="wx-bubble"><div className="wx-text">{previewBody}</div></div>
              </div>
            )}

            {windowOpen && (
              <button type="button" className="wx-tpl-cancel" onClick={() => { setMode("text"); setTplName(""); setPreview(false); }}>
                Back to normal message
              </button>
            )}
          </div>
        ) : (
          <div className="wx-compose">
            <button type="button" className="wx-round ghost" title="Send a template message" onClick={() => setMode("template")}>
              <WaIcon name="template" size={22} />
            </button>
            <textarea ref={area} rows={1} value={text} onChange={onType} onKeyDown={onKey}
              placeholder="Type a message" disabled={sending} autoFocus />
            <button type="button" className="wx-round send" title="Send" onClick={send} disabled={sending || !text.trim()}>
              <WaIcon name="send" size={20} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}