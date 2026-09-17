import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes.js";
import senderRoutes from "./routes/sender.routes.js";
import campaignRoutes from "./routes/campaign.routes.js";
import emailRoutes from "./routes/email.routes.js";
import slackRoutes from "./routes/slack.routes.js";
import { ensureEmailIndex } from "./services/elasticsearch.service.js";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "./lib/queue.js";
import { requireAuth } from "./middleware/auth.middleware.js";

const app = express();
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: frontendUrl, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ success: true, service: "reachinbox-backend", timestamp: new Date().toISOString() }));
app.use("/api/auth", authRoutes);
app.use("/api", senderRoutes);
app.use("/api", campaignRoutes);
app.use("/api", emailRoutes);
app.use("/api/slack", slackRoutes);

const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath("/admin/queues");
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: bullBoardAdapter });
app.use("/admin/queues", requireAuth, bullBoardAdapter.getRouter());

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API error:", error);
  return res.status(500).json({ success: false, error: "Internal server error" });
});

void ensureEmailIndex();

export default app;
