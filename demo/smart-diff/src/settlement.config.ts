/* Config — classifier rule 8 (*.config.*) puts this in `wiring`. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  redisUrl: process.env.REDIS_URL,
  settlementWindowDays: 30,
  retryLimit: 3,
  gatewayBaseUrl: process.env.GATEWAY_URL ?? "https://api.example.com",
};
