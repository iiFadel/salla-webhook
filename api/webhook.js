import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // ✅ 1. Token-based verification
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.SALLA_WEBHOOK_TOKEN}`) {
    console.error("❌ Invalid or missing webhook token");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ✅ 2. Extract the payload normally
  const { event, data } = req.body;

  console.log(`✅ Valid Webhook Received: ${event}`);

  // ✅ 3. Save tokens when merchant authorizes app
  if (event === "app.store.authorize") {
    const { merchant, access_token, refresh_token, expires_in } = data;

    await redis.set(`store:${merchant}:tokens`, {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
      merchant,
    });

    console.log(`✅ Tokens stored for merchant: ${merchant}`);
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

  default:
    console.log(`⚠️ Ignored event: ${event}`);
}

return res.status(200).json({ received: true });
}