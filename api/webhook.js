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
  const { event, merchant, data, created_at } = req.body;
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

    case "order.updated":
      const orderId = data?.id;
      const orderStatus = data?.status?.slug?.toLowerCase();
      const orderStatusName = data?.status?.name;
      
      if (!orderId) {
        console.error("❌ No order ID found in order.updated event");
        break;
      }

      console.log(`📦 Order updated: ${orderId}`);
      console.log(`📊 Status: ${orderStatusName} (${orderStatus})`);
      console.log(`💰 Order total: ${data?.amounts?.total?.amount || data?.total?.amount} ${data?.amounts?.total?.currency || data?.total?.currency || "SAR"}`);

      // Handle different order statuses
      if (orderStatus === "paid" || orderStatus === "completed") {
        console.log(`💳 Order ${orderId} is paid`);
        
        // Trigger N8N payment webhook if configured
        if (process.env.N8N_PAYMENT_WEBHOOK_URL) {
          try {
            await fetch(process.env.N8N_PAYMENT_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id: orderId,
                reference_id: data.reference_id,
                status: orderStatus,
                merchant: merchant,
                total: data?.amounts?.total || data?.total,
                customer: data?.customer,
                event: "order.updated.paid",
                timestamp: new Date().toISOString(),
              }),
            });
            console.log(`✅ Payment webhook sent to N8N for order ${orderId}`);
          } catch (error) {
            console.error(`❌ Failed to send payment webhook:`, error);
          }
        }
      }

      // Check for cancelled status
      if (orderStatus === "cancelled" || orderStatus === "canceled" || orderStatusName?.toLowerCase().includes("cancel")) {
        console.log(`❌ Order ${orderId} is cancelled`);
        
        // Trigger N8N cancellation webhook if configured
        if (process.env.N8N_CANCELLATION_WEBHOOK_URL) {
          try {
            await fetch(process.env.N8N_CANCELLATION_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id: orderId,
                reference_id: data.reference_id,
                status: orderStatus,
                merchant: merchant,
                total: data?.amounts?.total || data?.total,
                customer: data?.customer,
                event: "order.updated.cancelled",
                timestamp: new Date().toISOString(),
              }),
            });
            console.log(`✅ Cancellation webhook sent to N8N for order ${orderId}`);
          } catch (error) {
            console.error(`❌ Failed to send cancellation webhook:`, error);
          }
        }
      }

      // Check for newly created order (typically pending or under_review status).
      if (orderStatus === "pending" || orderStatus === "under_review" || orderStatus === "new" || !data?.status?.slug) {
        console.log(`🆕 Order ${orderId} is newly created/pending`);
        
        // Trigger N8N webhook for new orders if configured
        if (process.env.N8N_ORDER_CREATED_WEBHOOK_URL) {
          try {
            await fetch(process.env.N8N_ORDER_CREATED_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id: orderId,
                reference_id: data.reference_id,
                status: orderStatus,
                merchant: merchant,
                total: data?.amounts?.total || data?.total,
                customer: data?.customer,
                event: "order.updated.created",
                timestamp: new Date().toISOString(),
              }),
            });
            console.log(`✅ Order created webhook sent to N8N for order ${orderId}`);
          } catch (error) {
            console.error(`❌ Failed to send order created webhook:`, error);
          }
        }
      }
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

    default:
      console.log(`⚠️ Ignored event: ${event}`);
  }

  return res.status(200).json({ received: true });
}