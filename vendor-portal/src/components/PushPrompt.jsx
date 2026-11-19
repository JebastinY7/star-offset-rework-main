import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { dismissPrompt, dismissedRecently, enablePush, pushAvailable, pushSupported, syncPush, watchPermission } from "../push";
import "../push.css";

// Notifications while the browser is closed (Web Push, see push.js + public/sw.js).
//  - already allowed  -> silently keeps this browser registered with the server
//  - not asked yet    -> a small card asks once (browsers only allow the question after a click)
//  - tapping a system notification while the portal is open -> the service worker sends the page to open here
export default function PushPrompt() {
  const nav = useNavigate();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!pushSupported()) return undefined;
    let alive = true;
    if (Notification.permission === "granted") syncPush();
    else if (Notification.permission === "default" && !dismissedRecently()) {
      pushAvailable().then((on) => { if (alive && on) setShow(true); });
    }
    // permission switched on from the lock icon while the portal is open (no reload): subscribe now
    const stop = watchPermission(() => { setShow(false); syncPush(); });
    return () => { alive = false; stop(); };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    const onMessage = (e) => { if (e.data?.type === "push-open" && e.data.link) nav(e.data.link); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [nav]);

  const finish = (text) => { setMsg(text); setTimeout(() => { setShow(false); setMsg(""); }, 4000); };

  const turnOn = async () => {
    setBusy(true);
    let result = "error";
    try { result = await enablePush(); } catch (e) { console.warn("Enable push failed", e); }
    setBusy(false);
    if (result === "granted") finish("Notifications are on. You will be alerted even when this browser is closed.");
    else if (result === "denied") { dismissPrompt(); finish("Notifications are blocked. Allow them in your browser's site settings to turn them on."); }
    else if (result !== "default") finish("Could not turn on notifications. Please try again later."); // "default" = box closed: keep asking
  };
  const later = () => { dismissPrompt(); setShow(false); };

  if (!show) return null;
  return (
    <div className="push-prompt no-print" role="dialog" aria-label="Notifications">
      <span className="pp-ico"><Icon name="bell" size={20} /></span>
      {msg ? (
        <div className="pp-text"><span>{msg}</span></div>
      ) : (
        <>
          <div className="pp-text">
            <b>Get alerts even when this browser is closed</b>
            <span>Turn on notifications for new orders and updates.</span>
          </div>
          <div className="pp-actions">
            <button type="button" onClick={later} disabled={busy}>Not now</button>
            <button type="button" className="pp-primary" onClick={turnOn} disabled={busy}>{busy ? "Please wait..." : "Turn on"}</button>
          </div>
        </>
      )}
    </div>
  );
}
