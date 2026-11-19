import { useState } from "react";
import Icon from "./Icon";

// label + password box with a show/hide toggle and a Caps Lock hint
export default function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, placeholder = "Your password" }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const watchCaps = (e) => setCaps(Boolean(e.getModifierState && e.getModifierState("CapsLock")));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} type={show ? "text" : "password"} value={value} placeholder={placeholder} onChange={onChange}
          onKeyDown={watchCaps} onKeyUp={watchCaps} onBlur={() => setCaps(false)} autoComplete={autoComplete} autoFocus={autoFocus} required />
        <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
          <Icon name={show ? "eyeoff" : "eye"} size={18} />
        </button>
      </div>
      {caps && <div className="hint warn">Caps Lock is on</div>}
    </div>
  );
}
