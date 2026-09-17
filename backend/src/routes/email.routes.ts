import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth.middleware.js";
import { searchEmails } from "../services/elasticsearch.service.js";
import { EmailStatus } from "../generated/prisma/enums.js";

const router = Router();
const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

router.get("/emails/scheduled", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const where = { userId: req.userId!, status: { in: [EmailStatus.SCHEDULED, EmailStatus.PROCESSING] } };
    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { sequence: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, recipient: true, subject: true, scheduledAt: true, status: true } }),
    ]);
    return res.json({ success: true, data: { items: emails, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
  } catch (error) {
    console.error("Scheduled email list error:", error);
    return res.status(400).json({ success: false, error: "Failed to fetch scheduled emails" });
  }
});

router.get("/emails/sent", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const where = { userId: req.userId!, status: { in: [EmailStatus.SENT, EmailStatus.FAILED] } };
    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({ where, orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, recipient: true, subject: true, sentAt: true, status: true, failureReason: true } }),
    ]);
    return res.json({ success: true, data: { items: emails, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
  } catch (error) {
    console.error("Sent email list error:", error);
    return res.status(400).json({ success: false, error: "Failed to fetch sent emails" });
  }
});

router.get("/emails/search", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const { page, pageSize } = paginationSchema.parse(req.query);
    const result = await searchEmails(req.userId!, query, page, pageSize);
    if (!result.available) return res.status(503).json({ success: false, error: "Search service is temporarily unavailable" });
    return res.json({ success: true, data: { items: result.results, pagination: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) } } });
  } catch (error) {
    console.error("Email search error:", error);
    return res.status(400).json({ success: false, error: "Invalid search request" });
  }
});

export default router;
