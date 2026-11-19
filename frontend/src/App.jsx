import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Billing from "./pages/Billing";
import Invoice from "./pages/Invoice";
import BillHistory from "./pages/BillHistory";
import BillDetail from "./pages/BillDetail";
import OrderHistory from "./pages/OrderHistory";
import Orders from "./pages/Orders";
import OrderForm from "./pages/OrderForm";
import Quotations from "./pages/Quotations";
import QuotationForm from "./pages/QuotationForm";
import QuotationBill from "./pages/QuotationBill";
import Messages from "./pages/Messages";
import MessageChat from "./pages/MessageChat";
import Offers from "./pages/Offers";
import OfferHistory from "./pages/OfferHistory";
import MembershipHistory from "./pages/MembershipHistory";
import Reports from "./pages/Reports";
import ReportDetail from "./pages/ReportDetail";
import ProfitLoss from "./pages/ProfitLoss";
import Settings from "./pages/Settings";
import ComingSoon from "./pages/ComingSoon";
import ShopOrders from "./pages/ShopOrders";
import ShopPayments from "./pages/ShopPayments";
import VendorWork from "./pages/VendorWork";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <div className="center-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Admin-only screens (same visibility rules as the sidebar)
function AdminOnly({ children }) {
  const { user } = useAuth();
  if (!user?.is_superuser) return <Navigate to="/dashboard" replace />;
  return children;
}

// Pages not yet migrated from the Django templates
const soon = (title, adminOnly = false) => {
  const page = <ComingSoon title={title} />;
  return adminOnly ? <AdminOnly>{page}</AdminOnly> : page;
};

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/billing/:billId/edit" element={<Billing />} />
        <Route path="/invoice/:id" element={<Invoice />} />
        <Route path="/history" element={<BillHistory />} />
        <Route path="/history/:id" element={<BillDetail />} />
        <Route path="/reports" element={<AdminOnly><Reports /></AdminOnly>} />
        <Route path="/reports/pnl" element={<AdminOnly><ProfitLoss /></AdminOnly>} />
        <Route path="/reports/:kind" element={<AdminOnly><ReportDetail /></AdminOnly>} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/shop-orders" element={<ShopOrders />} />
        <Route path="/shop-orders/:orderId" element={<ShopOrders />} />
        <Route path="/vendor-work" element={<AdminOnly><VendorWork /></AdminOnly>} />
        <Route path="/shop-payments" element={<AdminOnly><ShopPayments /></AdminOnly>} />
        <Route path="/orders/new" element={<OrderForm />} />
        <Route path="/orders/:orderId/edit" element={<OrderForm />} />
        <Route path="/quotations" element={<Quotations />} />
        <Route path="/quotations/new" element={<QuotationForm />} />
        <Route path="/quotations/:quotationId/edit" element={<QuotationForm />} />
        <Route path="/quotations/:id/bill" element={<QuotationBill />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/messages/:phone" element={<MessageChat />} />
        <Route path="/offers" element={<Offers />} />
        <Route path="/offers/history" element={<OfferHistory />} />
        <Route path="/order-history" element={<OrderHistory />} />
        <Route path="/membership-history" element={<AdminOnly><MembershipHistory /></AdminOnly>} />
        {/* Price Setup routes are intentionally disabled because pricing is managed
            in backend code. Keep the route definitions commented for future use.
        <Route path="/pricing/setup" element={soon("Normal Price Setup", true)} />
        <Route path="/pricing/digital-price-setup" element={soon("Digital Price Setup", true)} />
        */}
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}