import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { CartProvider } from "./CartContext.jsx";
import { WalletProvider } from "./WalletContext.jsx";
import "./styles.css";
import "./dark.css"; // dark theme overrides - keep this import last

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <WalletProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </WalletProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);