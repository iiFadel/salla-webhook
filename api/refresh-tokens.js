import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const keys = await redis.keys("store:*:tokens");
    
    const results = [];

    for (const key of keys) {
      const tokenData = await redis.get(key);
      
      if (!tokenData) continue;

      const { refresh_token, merchant } = tokenData;

      const response = await fetch("https://accounts.salla.sa/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.SALLA_CLIENT_ID,
          client_secret: process.env.SALLA_CLIENT_SECRET,
          refresh_token: refresh_token,
          grant_type: "refresh_token"
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to refresh token for ${merchant}:`, errorText);
        results.push({ merchant, success: false, error: errorText });
        continue;
      }

      const newTokens = await response.json();

      await redis.set(`store:${merchant}:tokens`, {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: Date.now() + (newTokens.expires_in * 1000),
        merchant
      });

      console.log(`✅ Token refreshed for merchant: ${merchant}`);
      results.push({ merchant, success: true });
    }

    res.status(200).json({ 
      success: true, 
      refreshed: results.length,
      results 
    });

  } catch (error) {
    console.error("Error refreshing tokens:", error);
    res.status(500).json({ error: error.message });
  }
}