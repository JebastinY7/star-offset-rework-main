import { useState } from "react";
import Icon from "./Icon";

export const MAX_FILES = 20;                    // per order (all items together)
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // per order
const ALLOWED = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp", ".svg", ".psd", ".ai", ".eps", ".cdr", ".indd", ".zip", ".rar", ".7z", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"];

export const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;
export const totalSize = (list) => list.reduce((n, f) => n + f.size, 0);
export const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const extOk = (f) => ALLOWED.some((e) => f.name.toLowerCase().endsWith(e));

// Choose files one batch at a time; every pick is added to the list.  `files` / `onChange` are controlled by the parent.
// `otherBytes` / `otherCount` = what the rest of the order already holds, so the order limits are respected.
export default function ArtworkPicker({ id, files, onChange, otherBytes = 0, otherCount = 0 }) {
  const [msg, setMsg] = useState("");

  const add = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // lets the same file be picked again and makes every pick fire onChange
    if (!picked.length) return;
    const seen = new Set(files.map(fileKey));
    const next = [...files];
    const notes = [];
    for (const f of picked) {
      if (!extOk(f)) { notes.push(`${f.name} (file type not accepted)`); continue; }
      if (seen.has(fileKey(f))) continue;
      if (otherCount + next.length >= MAX_FILES) { notes.push(`${f.name} (limit of ${MAX_FILES} files per order)`); continue; }
      if (otherBytes + totalSize(next) + f.size > MAX_TOTAL_BYTES) { notes.push(`${f.name} (order files would exceed ${MAX_TOTAL_BYTES / 1048576} MB)`); continue; }
      seen.add(fileKey(f));
      next.push(f);
    }
    setMsg(notes.length ? `Not added: ${notes.join(", ")}` : "");
    if (next.length !== files.length) onChange(next);
  };

  return (
    <div className="artwork">
      <label className="file-drop" htmlFor={id}>
        <Icon name="plus" size={16} /> {files.length ? "Add more files" : "Choose artwork files"}
        <input id={id} type="file" multiple className="sr-only" onChange={add} />
      </label>
      <span className="muted small">PDF, images, PSD, AI, EPS, CDR, ZIP, Office files · up to {MAX_FILES} files, {MAX_TOTAL_BYTES / 1048576} MB per order</span>
      {msg && <p className="alert error small">{msg}</p>}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={fileKey(f)}>
              <span className="file-name">{f.name}</span>
              <span className="muted small">{sizeText(f.size)}</span>
              <button type="button" className="link-btn danger" onClick={() => onChange(files.filter((x) => fileKey(x) !== fileKey(f)))} aria-label={`Remove ${f.name}`}><Icon name="close" size={14} /> Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
