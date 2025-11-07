import crypto from "crypto";
import getRawBody from "raw-body"; 
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const secret = process.env.SALLA_SECRET;
  const signature = req.headers["x-salla-signature"];

  // ✅ Read raw body from the request
  const rawBody = (await getRawBody(req)).toString("utf8");

  // ✅ Validate signature using raw body
  const expectedHash = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (expectedHash !== signature) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // ✅ Only after validating, parse JSON
  const { event, data } = JSON.parse(rawBody);

  console.log("✅ Webhook verified:", event);

  // Store access + refresh tokens
  if (event === "app.store.authorize") {
    const { merchant, access_token, refresh_token, expires_in } = data;

    await redis.set(`store:${merchant}:tokens`, {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
      merchant,
    });

    console.log(`✅ Tokens saved for merchant: ${merchant}`);
    return res.status(200).json({ received: true });
  }

switch (event) {
  case "app.store.authorize":
    // ✅ Store access + refresh token
    const { merchant, access_token, refresh_token, expires_in } = data;
    await redis.set(`store:${merchant}:tokens`, {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
      merchant,
    });
    console.log(`✅ Tokens saved for merchant: ${merchant}`);
    break;

  case "order.created":
    console.log(`🛒 New order created: ${data.id}`);
    // Example: send to N8N or save to DB
    // await fetch(process.env.N8N_NEW_ORDER_URL, { ... });
    break;

  case "order.status.updated":
    console.log(`✅ Order status updated: ${data.id} → ${data.status?.name}`);
    const newStatus = data.status?.name?.toLowerCase();

    if (newStatus === "paid") {
      await fetch(process.env.N8N_PAYMENT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: data.id, status: newStatus }),
      });
    }

    if (newStatus === "cancelled" || newStatus === "canceled") {
      await fetch(process.env.N8N_CANCELLATION_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: data.id, status: newStatus }),
      });
    }
    break;

  case "refund.created":
    console.log(`💸 Refund created for order: ${data.order_id}`);
    // Example:
    // await fetch(process.env.N8N_REFUND_WEBHOOK_URL, { ... });
    break;

  default:
    console.log(`⚠️ Ignored event: ${event}`);
}

return res.status(200).json({ received: true });
}