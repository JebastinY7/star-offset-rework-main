// Icons for the Messages screens - same line-icon set as the rest of the app (see Icon.jsx).
import Icon from "./Icon";

const alias = { chat: "message", down: "chevron" };

export default function WaIcon({ name, size = 20, className = "" }) {
  return <Icon name={alias[name] || name} size={size} className={className} />;
}

// WhatsApp "sent" double tick, shown on our own messages
export function Tick({ size = 15 }) {
  return <span className="wx-tick" aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "middle" }}><Icon name="tick" size={size} /></span>;
}
