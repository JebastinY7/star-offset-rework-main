import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import ForcePassword from "./pages/ForcePassword";
import ForgotPassword from "./pages/ForgotPassword";
import ForgotUserId from "./pages/ForgotUserId";
import ContactSupport from "./pages/ContactSupport";
import MyOrders from "./pages/MyOrders";
import OrderDetail from "./pages/OrderDetail";
import Invoice from "./pages/Invoice";
import OrderHistory from "./pages/OrderHistory";
import PlaceOrder from "./pages/PlaceOrder";
import ShopProfile from "./pages/ShopProfile";
import OrderCart from "./pages/OrderCart";
import PrintingPrices from "./pages/PrintingPrices";
import ServiceDetail from "./pages/ServiceDetail";
import PrintingServiceDetail from "./pages/PrintingServiceDetail";
import SetPassword from "./pages/SetPassword";
import Wallet from "./pages/Wallet";

function RequireShop({ children }) {
  const { shop } = useAuth();
  const location = useLocation();
  if (shop === undefined) return <div className="center-screen muted">Loading…</div>;
  if (!shop) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (shop.must_change_password) return <ForcePassword />; // temporary password: choose your own first
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-user-id" element={<ForgotUserId />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/setup-password/:uid/:token" element={<SetPassword />} />
      <Route element={<RequireShop><Layout /></RequireShop>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/prices" element={<PrintingPrices />} />
        <Route path="/prices/printing" element={<PrintingServiceDetail />} />
        <Route path="/prices/:kind/:id" element={<ServiceDetail />} />
        <Route path="/cart" element={<OrderCart />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/orders/new" element={<PlaceOrder />} />
        <Route path="/orders" element={<MyOrders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/orders/:id/invoice" element={<Invoice />} />
        <Route path="/order-history" element={<OrderHistory />} />
        <Route path="/profile" element={<ShopProfile />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/contact" element={<ContactSupport />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}