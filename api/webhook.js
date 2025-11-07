import crypto from "crypto";
import getRawBody from "raw-body";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// ✅ Required for raw body
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1. Get raw payload
  const rawBody = (await getRawBody(req)).toString("utf8");
  const signature = req.headers["x-salla-signature"];
  const secret = process.env.SALLA_SECRET;

  // 2. Calculate our own hash
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // 3. If mismatch → LOG EVERYTHING BEFORE rejecting
  if (expected !== signature) {
    console.error("❌ INVALID SIGNATURE from Salla");
    console.error("➡ Raw Body:", rawBody);
    console.error("➡ Salla Signature:", signature);
    console.error("➡ Expected Hash:", expected);
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 4. Now it's safe to parse JSON
  const { event, data } = JSON.parse(rawBody);
  console.log("✅ Valid webhook:", event);

  // ✅ Handle token saving
  if (event === "app.store.authorize") {
    const { merchant, access_token, refresh_token, expires_in } = data;
    await redis.set(`store:${merchant}:tokens`, {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
      merchant
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