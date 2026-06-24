import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.env.INIT_CWD ?? process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env"), override: true });

export const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  mongoUri: process.env.MONGODB_URI,
  notificationEmail: process.env.LEAD_NOTIFICATION_EMAIL ?? process.env.BUSINESS_EMAIL ?? "",
  whatsappNumber: process.env.LEAD_WHATSAPP_NUMBER ?? ""
};
