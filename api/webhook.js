import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Token from headers (Salla may send it without "Bearer ")
  const headerAuth = req.headers["authorization"];
  const signature = req.headers["x-salla-signature"];
  const token = process.env.SALLA_WEBHOOK_TOKEN;

  const valid =
    headerAuth === token || // Salla sends raw token
    headerAuth === `Bearer ${token}` || // curl/manual test
    signature === token; // Salla using x-salla-signature

  if (!valid) {
    console.error("❌ Invalid or missing webhook token");
    console.log("Received headers:", req.headers);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ✅ Token is valid — handle webhook
  const { event, data } = req.body;
  console.log(`✅ Valid Webhook: ${event}`);

  if (event === "app.store.authorize") {
    const { merchant, access_token, refresh_token, expires_in } = data;
    await redis.set(`store:${merchant}:tokens`, {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
      merchant
    });
    console.log(`✅ Tokens saved for merchant: ${merchant}`);
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

  default:
    console.log(`⚠️ Ignored event: ${event}`);
}

return res.status(200).json({ received: true });
}