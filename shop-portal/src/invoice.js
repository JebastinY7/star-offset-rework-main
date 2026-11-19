import api from "./api";

// File name the server chose (Invoice-ORD-0007-<Shop-Name>.pdf), read from the Content-Disposition header.
const nameFrom = (header) => /filename="?([^";]+)"?/i.exec(header || "")?.[1];

// Downloads the PDF invoice of one order. Throws an Error with a readable message when it fails.
export async function downloadInvoice(id, fallbackName = "Invoice") {
  let res;
  try {
    res = await api.get(`/shop/orders/${id}/invoice/pdf/`, { responseType: "blob" });
  } catch (e) {
    let message = "Could not download the invoice. Please try again.";
    const body = e.response?.data;
    if (body instanceof Blob) { // an error page comes back as a blob too
      try { message = JSON.parse(await body.text()).error || message; } catch { /* keep the generic message */ }
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement("a"), { href: url, download: nameFrom(res.headers["content-disposition"]) || `${fallbackName}.pdf` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
