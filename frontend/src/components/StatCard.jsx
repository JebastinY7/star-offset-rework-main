import Icon from "./Icon";

// tone: gold | blue | purple | green | red | orange  (colors the icon and the top line)
export default function StatCard({ label, value, icon, tone = "gold" }) {
  return (
    <div className={`dash-stat ${tone}`}>
      <span className="dash-stat-icon"><Icon name={icon} size={22} /></span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}