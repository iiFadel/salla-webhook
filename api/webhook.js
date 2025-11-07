import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // ✅ Handle GET requests (webhook verification)
  if (req.method === "GET") {
    return res.status(200).json({ 
      status: "ok", 
      message: "Webhook endpoint is active" 
    });
  }

  // ✅ Handle POST requests (actual webhook events)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Token validation
  const headerAuth = req.headers["authorization"];
  const signature = req.headers["x-salla-signature"];
  const token = process.env.SALLA_WEBHOOK_TOKEN;

  const valid =
    headerAuth === token ||
    headerAuth === `Bearer ${token}` ||
    signature === token;

  if (!valid) {
    console.error("❌ Invalid or missing webhook token");
    console.log("Received headers:", req.headers);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Handle webhook events
  const { event, data } = req.body;
  console.log(`✅ Valid Webhook: ${event}`);

  switch (event) {
    case "app.store.authorize":
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
      break;

    case "order.status.updated":
      console.log(`✅ Order status updated: ${data.id} → ${data.status?.name}`);
      const newStatus = data.status?.name?.toLowerCase();

      if (newStatus === "paid" && process.env.N8N_PAYMENT_WEBHOOK_URL) {
        await fetch(process.env.N8N_PAYMENT_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: data.id, status: newStatus }),
        });
      }

      if ((newStatus === "cancelled" || newStatus === "canceled") && process.env.N8N_CANCELLATION_WEBHOOK_URL) {
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