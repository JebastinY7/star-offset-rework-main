import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import { NAV } from "./components/navConfig";
import ComingSoon from "./pages/ComingSoon";
import AssignedWork from "./pages/AssignedWork";
import Dashboard from "./pages/Dashboard";
import ForgotPassword from "./pages/ForgotPassword";
import ForgotUserId from "./pages/ForgotUserId";
import History from "./pages/History";
import InProgress from "./pages/InProgress";
import Completed from "./pages/Completed";
import Login from "./pages/Login";
import PriceRequests from "./pages/PriceRequests";
import Profile from "./pages/Profile";
import ReadyForPickup from "./pages/ReadyForPickup";
import Support from "./pages/Support";
import WorkDetail from "./pages/WorkDetail";

function RequireVendor({ children }) {
  const { vendor } = useAuth();
  const location = useLocation();
  if (vendor === undefined) return <div className="center-screen muted">Loading…</div>;
  if (!vendor) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-user-id" element={<ForgotUserId />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<RequireVendor><Layout /></RequireVendor>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/assigned" element={<AssignedWork />} />
        <Route path="/assigned/:id" element={<WorkDetail />} />
        <Route path="/in-progress" element={<InProgress />} />
        <Route path="/ready" element={<ReadyForPickup />} />
        <Route path="/completed" element={<Completed />} />
        <Route path="/price-requests" element={<PriceRequests />} />
        <Route path="/history" element={<History />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/support" element={<Support />} />
        {/* sidebar pages without a real page yet - replace each with its page when built */}
        {NAV.filter((i) => !i.built).map((i) => <Route key={i.to} path={i.to} element={<ComingSoon />} />)}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}