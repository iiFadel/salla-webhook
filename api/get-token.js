import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Security: Verify the request is coming from your n8n instance
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${process.env.N8N_SECRET}`;

  if (authHeader !== expectedAuth) {
    console.error("❌ Unauthorized token request");
    console.error("Received:", authHeader);
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get merchant ID (you can pass it as query param or use default)
    const merchant = req.query.merchant || process.env.DEFAULT_MERCHANT_ID;

    if (!merchant) {
      return res.status(400).json({ 
        error: "Merchant ID is required",
        hint: "Pass ?merchant=12345 or set DEFAULT_MERCHANT_ID in env"
      });
    }

    // Fetch token from Redis
    const tokenData = await redis.get(`store:${merchant}:tokens`);

    if (!tokenData) {
      return res.status(404).json({ 
        error: "No token found for this merchant",
        merchant: merchant,
        hint: "Make sure the app is authorized in Salla dashboard"
      });
    }

    // Extract token info
    const { access_token, expires_at, refresh_token } = tokenData;

    // Check if token is expired or about to expire (1 hour buffer)
    const now = Date.now();
    const expiresAtMs = expires_at * 1000; // Convert to milliseconds if in seconds
    const isExpiringSoon = expiresAtMs < (now + 3600000); // Less than 1 hour left

    if (isExpiringSoon) {
      console.warn(`⚠️ Token for merchant ${merchant} is expiring soon`);
    }

    // Calculate hours until expiration
    const hoursRemaining = Math.floor((expiresAtMs - now) / 3600000);

    // Return the token
    return res.status(200).json({
      success: true,
      access_token: access_token,
      expires_at: expires_at,
      expires_at_iso: new Date(expiresAtMs).toISOString(),
      expires_in_hours: hoursRemaining,
      is_expiring_soon: isExpiringSoon,
      merchant: merchant
    });

  } catch (error) {
    console.error("❌ Error fetching token:", error);
    return res.status(500).json({ 
      error: "Internal server error",
      message: error.message 
    });
  }
}