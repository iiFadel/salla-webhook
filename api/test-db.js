import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await redis.set("test-key", { 
      message: "Hello from Upstash!", 
      timestamp: Date.now() 
    });
    
    const data = await redis.get("test-key");
    
    const keys = await redis.keys("*");
    
    res.status(200).json({ 
      success: true, 
      test_data: data,
      all_keys: keys,
      env_configured: {
        url: !!process.env.KV_REST_API_URL,
        token: !!process.env.KV_REST_API_TOKEN
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}