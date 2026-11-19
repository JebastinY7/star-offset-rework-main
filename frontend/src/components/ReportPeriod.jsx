import { useState } from "react";
import { PRESETS, detectPreset, presetRange } from "../lib/reports";

// "Report Period" card: From / To dates + quick ranges + Apply / Reset.
// `from` / `to` are the applied dates (YYYY-MM-DD); onApply({ from, to }) is called with new ones.
// Picking a quick range applies at once; typing dates needs Apply.
// The parent gives it key={from + to} so it starts fresh whenever the applied period changes.
export default function ReportPeriod({ from, to, onApply }) {
  const [draft, setDraft] = useState({ from, to });
  const [preset, setPreset] = useState(() => detectPreset(from, to));

  const invalid = !draft.from || !draft.to || draft.from > draft.to;
  const changed = draft.from !== from || draft.to !== to;
  const isDefault = detectPreset(from, to) === "month";

  const edit = (key) => (e) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setPreset("custom");
  };
  const pick = (e) => {
    const key = e.target.value;
    setPreset(key);
    if (key === "custom") return;
    const range = presetRange(key);
    setDraft(range);
    onApply(range);
  };

  return (
    <div className="card rp-period">
      <h3>Report Period</h3>
      <div className="rp-period-row">
        <label>From Date
          <input type="date" value={draft.from} max={draft.to || undefined} onChange={edit("from")} />
        </label>
        <label>To Date
          <input type="date" value={draft.to} min={draft.from || undefined} onChange={edit("to")} />
        </label>
        <label>Quick range
          <select value={preset} onChange={pick} aria-label="Quick range">
            {PRESETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="rp-period-btns">
          <button type="button" className="primary" disabled={invalid || !changed} onClick={() => onApply(draft)}>Apply</button>
          <button type="button" disabled={isDefault && !changed} onClick={() => onApply(presetRange("month"))}>Reset</button>
        </div>
      </div>
      {draft.from && draft.to && draft.from > draft.to && <div className="error">“From” date must be on or before the “To” date.</div>}
    </div>
  );
}