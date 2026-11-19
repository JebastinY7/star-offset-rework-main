import axios from "axios";

const csrfToken = () =>
  document.cookie.split("; ").find((c) => c.startsWith("csrftoken="))?.split("=")[1];

const api = axios.create({ baseURL: "/api", withCredentials: true });

api.interceptors.request.use((cfg) => {
  const t = csrfToken();
  if (t) cfg.headers["X-CSRFToken"] = t;
  return cfg;
});

export default api;

// Turn a DRF error response into one readable string
export function errorText(err) {
  const d = err?.response?.data;
  if (!d) return "Network error. Is the Django server running?";
  if (typeof d === "string") return `Server error (${err.response.status}). Please try again later.`; // HTML error page
  if (d.error) return d.error;
  if (d.detail) return d.detail;
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
    .join(" | ");
}
