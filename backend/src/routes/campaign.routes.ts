import { Router } from "express";
import { z } from "zod";
import { scheduleCampaign } from "../services/scheduler.service.js";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
const emailSchema = z.string().trim().toLowerCase().email();

const scheduleCampaignSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(200_000),
  recipients: z.array(emailSchema).min(1).max(10_000),
  startTime: z.coerce.date(),
  delayMs: z.number().int().min(0),
  hourlyLimit: z.number().int().min(1).max(100_000),
});

router.post("/campaigns", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = scheduleCampaignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Invalid campaign information", details: parsed.error.flatten() });

    const result = await scheduleCampaign({ ...parsed.data, userId: req.userId! });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error("Schedule campaign error:", error);
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed to schedule campaign" });
  }
});

export default router;
