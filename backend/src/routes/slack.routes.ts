import { Router } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth.middleware.js";
import { consumeSlackState, createSlackState, disconnectSlack, exchangeSlackCode, getSlackAuthorizationUrl, getSlackStatus, saveSlackConnection } from "../services/slack.service.js";

const router = Router();

router.get("/connect", requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const state = createSlackState(req.userId!);
    return res.redirect(getSlackAuthorizationUrl(state));
  } catch (error) {
    return res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Slack is not configured" });
  }
});

router.get("/callback", async (req, res) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const userId = consumeSlackState(state);
    if (!userId || !code) return res.status(400).json({ success: false, error: "Invalid Slack OAuth state or code" });
    const payload = await exchangeSlackCode(code);
    await saveSlackConnection(userId, payload);
    return res.redirect(`${process.env.FRONTEND_URL ?? "http://localhost:5173"}/dashboard?slack=connected`);
  } catch (error) {
    console.error("Slack OAuth callback error:", error);
    return res.status(500).json({ success: false, error: "Slack connection failed" });
  }
});

router.get("/status", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    return res.json({ success: true, data: await getSlackStatus(req.userId!) });
  } catch (error) {
    console.error("Slack status error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch Slack status" });
  }
});

router.post("/disconnect", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await disconnectSlack(req.userId!);
    return res.json({ success: true, data: null });
  } catch (error) {
    console.error("Slack disconnect error:", error);
    return res.status(500).json({ success: false, error: "Failed to disconnect Slack" });
  }
});

export default router;
