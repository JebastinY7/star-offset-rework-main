import api, { errorText } from "./api";

// Razorpay Checkout helper. The backend creates the Razorpay order and verifies the payment signature;
// the money is credited to the shop wallet only after that verification (see backend wallet_api.py).
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Razorpay. Check your internet connection and try again."));
    document.body.appendChild(s);
  });
}

// Opens Razorpay for `amount` (rupees). Resolves "paid" once the backend has verified and credited the
// payment, or "cancelled" if the shop closed the window. Rejects with an Error if the payment failed.
// purpose "order" = paying an order online (allows amounts below the normal Rs 100 top-up minimum).
export async function payOnline(amount, purpose = "topup") {
  const { data } = await api.post("/shop/wallet/topup/create/", { amount: Number(amount).toFixed(2), purpose });
  await loadCheckout();
  return new Promise((resolve, reject) => {
    let paying = false;      // handler is verifying - the modal closing must not count as a cancel
    let lastFailure = "";    // Razorpay lets the shop retry inside the window, so only report a failure if they give up
    const checkout = new window.Razorpay({
      key: data.key_id, amount: data.amount, currency: data.currency,
      name: "Star Offset Printing", description: purpose === "order" ? "Printing order payment" : "Shop wallet top-up",
      order_id: data.razorpay_order_id,
      prefill: { name: data.shop_name, email: data.email, contact: data.phone },
      theme: { color: "#15803d" },
      handler: async (response) => {
        paying = true;
        try {
          await api.post("/shop/wallet/topup/verify/", response);
          resolve("paid");
        } catch (e) {
          reject(e);
        }
      },
      modal: {
        backdropclose: false, // clicking outside must not close the window - only the X button
        escape: false,
        ondismiss: () => {
          if (paying) return;
          if (lastFailure) reject(new Error(lastFailure)); else resolve("cancelled");
        },
      },
    });
    checkout.on("payment.failed", (r) => { lastFailure = r?.error?.description || "Payment failed. Please try again."; });
    checkout.open();
  });
}

// Readable message for anything payOnline can throw (API errors or plain Errors)
export const payError = (e) => (e?.response ? errorText(e) : e?.message || "Payment failed. Please try again.");