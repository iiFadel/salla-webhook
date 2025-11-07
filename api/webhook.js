import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ 
      status: "ok", 
      message: "Webhook endpoint is active" 
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Token validation
  const headerAuth = req.headers["authorization"];
  const signature = req.headers["x-salla-signature"];
  const token = process.env.SALLA_SECRET;

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
  const { event, merchant, data } = req.body;
  console.log(`✅ Valid Webhook: ${event}`);
  console.log(`🏪 Merchant: ${merchant}`);
  console.log("📦 Full webhook body:", JSON.stringify(req.body, null, 2));

  switch (event) {
    case "app.store.authorize":
      const merchantId = merchant || data?.merchant || data?.store_id;
      const access_token = data?.access_token;
      const refresh_token = data?.refresh_token;
      const expires = data?.expires;
      const scope = data?.scope;
      const token_type = data?.token_type;
      
      if (!merchantId) {
        console.error("❌ No merchant ID found");
        console.error("Full body:", JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: "Missing merchant ID" });
      }

      if (!access_token) {
        console.error("❌ No access token found for merchant:", merchantId);
        console.error("Data received:", JSON.stringify(data, null, 2));
        return res.status(400).json({ error: "Missing access token" });
      }

      const tokenData = {
        access_token,
        refresh_token,
        expires_at: expires,
        expires_at_iso: new Date(expires * 1000).toISOString(),
        merchant: merchantId,
        authorized_at: created_at || new Date().toISOString(),
        scope: scope,
        token_type: token_type || "bearer",
      };

      await redis.set(`store:${merchantId}:tokens`, tokenData);

      console.log(`✅ Tokens saved for merchant: ${merchantId}`);
      console.log(`🔑 Access token: ${access_token.substring(0, 30)}...`);
      console.log(`🔄 Refresh token: ${refresh_token?.substring(0, 30)}...`);
      console.log(`⏰ Expires at: ${new Date(expires * 1000).toISOString()}`);
      break;

    case "order.created":
      console.log(`🛒 New order created: ${data.id}`);
      console.log(`💰 Order total: ${data?.total?.amount} ${data?.total?.currency}`);
      break;

    case "app.installed":
      console.log(`📲 App installed for merchant: ${merchant}`);
      console.log(`🆔 App ID: ${data?.id}`);
      console.log(`📝 App name: ${data?.app_name}`);
      console.log(`🔐 Scopes: ${data?.app_scopes?.join(", ")}`);
      console.log(`📅 Installation date: ${data?.installation_date}`);
      
      // Optionally store installation info
      await redis.set(`store:${merchant}:app_info`, {
        app_id: data?.id,
        app_name: data?.app_name,
        app_type: data?.app_type,
        scopes: data?.app_scopes,
        installation_date: data?.installation_date,
        store_type: data?.store_type,
      });
      
      console.log(`✅ App info saved for merchant: ${merchant}`);
      break;
    // case "order.status.updated":
    //   console.log(`✅ Order status updated: ${data.id} → ${data.status?.name}`);
    //   const newStatus = data.status?.name?.toLowerCase();

    //   if (newStatus === "paid" && process.env.N8N_PAYMENT_WEBHOOK_URL) {
    //     await fetch(process.env.N8N_PAYMENT_WEBHOOK_URL, {
    //       method: "POST",
    //       headers: { "Content-Type": "application/json" },
    //       body: JSON.stringify({ order_id: data.id, status: newStatus }),
    //     });
    //   }

    //   if ((newStatus === "cancelled" || newStatus === "canceled") && process.env.N8N_CANCELLATION_WEBHOOK_URL) {
    //     await fetch(process.env.N8N_CANCELLATION_WEBHOOK_URL, {
    //       method: "POST",
    //       headers: { "Content-Type": "application/json" },
    //       body: JSON.stringify({ order_id: data.id, status: newStatus }),
    //     });
    //   }
    //   break;

    default:
      console.log(`⚠️ Ignored event: ${event}`);
  }

  return res.status(200).json({ received: true });
}