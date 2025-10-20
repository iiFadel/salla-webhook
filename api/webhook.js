import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify signature
  const secret = process.env.SALLA_SECRET;
  const signature = req.headers["x-salla-signature"];
  
  if (!secret || !signature) {
    console.error("❌ Missing secret or signature");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = JSON.stringify(req.body);
  const hash = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  
  if (hash !== signature) {
    console.error("❌ Invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.body.event;
  const data = req.body.data;

  console.log(`✅ Salla webhook: ${event} | Order: ${data?.id}`);

  // Helper to send to n8n
  async function notifyN8n(url, payload) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        console.log(`✅ n8n notified for ${event}`);
        return true;
      } else {
        console.error(`❌ n8n error: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to notify n8n:`, error.message);
      return false;
    }
  }

  // Route events
  try {
    switch(event) {
      
      // PRIMARY: Order status changed (includes payment & cancellation)
      case "order.status.updated":
        const newStatus = data.status?.name?.toLowerCase();
        
        if (newStatus === "paid" || newStatus === "completed") {
          console.log("💰 Payment confirmed");
          await notifyN8n(process.env.N8N_PAYMENT_WEBHOOK_URL, {
            event: "payment_received",
            order_id: data.id,
            reference_id: data.reference_id,
            amount: data.amounts?.total,
            currency: data.amounts?.currency_code,
            customer: {
              name: data.customer?.name,
              phone: data.customer?.mobile,
              email: data.customer?.email
            },
            status: newStatus,
            paid_at: data.date?.paid || new Date().toISOString()
          });
          
        } else if (newStatus === "canceled" || newStatus === "cancelled") {
          console.log("🚫 Order cancelled");
          await notifyN8n(process.env.N8N_CANCELLATION_WEBHOOK_URL, {
            event: "order_cancelled",
            order_id: data.id,
            reference_id: data.reference_id,
            cancelled_at: data.date?.cancelled || new Date().toISOString(),
            reason: data.cancellation_reason
          });
        }
        break;

      // BACKUP: Explicit cancellation
      case "order.canceled":
        console.log("🚫 Order explicitly cancelled");
        await notifyN8n(process.env.N8N_CANCELLATION_WEBHOOK_URL, {
          event: "order_cancelled",
          order_id: data.id,
          reference_id: data.reference_id,
          cancelled_at: data.date?.cancelled || new Date().toISOString(),
          reason: data.cancellation_reason
        });
        break;

      // LOGGING: Order created
      case "order.created":
        console.log("📋 Order created (logging only)");
        // Optional: Log to Airtable for tracking
        await notifyN8n(process.env.N8N_LOGGING_WEBHOOK_URL, {
          event: "order_created",
          order_id: data.id,
          reference_id: data.reference_id,
          created_at: data.date?.created || new Date().toISOString()
        });
        break;

      // BACKUP: Payment method updated (might indicate payment success)
      case "order.payment.updated":
        console.log("💳 Payment method updated");
        // Check if payment status also changed to paid
        if (data.payment?.status === "paid") {
          await notifyN8n(process.env.N8N_PAYMENT_WEBHOOK_URL, {
            event: "payment_received",
            order_id: data.id,
            reference_id: data.reference_id,
            amount: data.amounts?.total,
            payment_method: data.payment?.method,
            paid_at: new Date().toISOString()
          });
        }
        break;

      // OPTIONAL: Refunds (Phase 6)
      case "order.refunded":
        console.log("💸 Order refunded");
        await notifyN8n(process.env.N8N_REFUND_WEBHOOK_URL, {
          event: "order_refunded",
          order_id: data.id,
          reference_id: data.reference_id,
          refund_amount: data.refund?.amount,
          refunded_at: new Date().toISOString()
        });
        break;

      // CATCH-ALL: Log unknown events
      default:
        console.log(`ℹ️ Unhandled event: ${event}`);
    }

  } catch (error) {
    console.error("❌ Error processing webhook:", error);
  }

  // Always acknowledge to Salla
  res.status(200).json({ 
    received: true,
    event: event,
    order_id: data?.id,
    processed_at: new Date().toISOString()
  });
}