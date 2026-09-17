import { Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth.middleware.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
const createSenderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  smtpHost: z.string().trim().min(1).max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().trim().min(1).max(255).optional(),
  smtpPassword: z.string().min(1).max(500).optional(),
});

router.get("/senders", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const senders = await prisma.sender.findMany({
      where: { userId: req.userId!, isActive: true },
      select: { id: true, name: true, email: true, smtpHost: true, smtpPort: true, smtpUser: true, isActive: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ success: true, data: senders });
  } catch (error) {
    console.error("Get senders error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch senders" });
  }
});

router.post("/senders", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = createSenderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Invalid sender information", details: parsed.error.flatten() });

    const { name, email, smtpHost, smtpPort, smtpUser, smtpPassword } = parsed.data;
    const existingSender = await prisma.sender.findFirst({ where: { userId: req.userId!, email } });
    if (existingSender) return res.status(409).json({ success: false, error: "A sender with this email already exists" });

    const host = smtpHost ?? process.env.ETHEREAL_HOST;
    const port = smtpPort ?? Number(process.env.ETHEREAL_PORT ?? 587);
    const user = smtpUser ?? process.env.ETHEREAL_USER;
    const password = smtpPassword ?? process.env.ETHEREAL_PASSWORD;
    if (!host || !user || !password) return res.status(500).json({ success: false, error: "SMTP configuration is missing" });

    const sender = await prisma.sender.create({
      data: { userId: req.userId!, name, email, smtpHost: host, smtpPort: port, smtpUser: user, smtpPassword: password },
      select: { id: true, name: true, email: true, smtpHost: true, smtpPort: true, smtpUser: true, isActive: true, createdAt: true },
    });
    return res.status(201).json({ success: true, data: sender });
  } catch (error) {
    console.error("Create sender error:", error);
    return res.status(500).json({ success: false, error: "Failed to create sender" });
  }
});

export default router;
