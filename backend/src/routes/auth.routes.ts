import { Router } from "express";
import {
    authenticateWithGoogle,
    getGoogleAuthUrl,
} from "../services/auth.service.js";
import {
    AuthenticatedRequest,
    requireAuth,
} from "../middleware/auth.middleware.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// Start Google OAuth
router.get("/google", (_req, res) => {
    const authUrl = getGoogleAuthUrl();

    return res.redirect(authUrl);
});

// Google OAuth callback
router.get("/google/callback", async (req, res) => {
    try {
        const code = req.query.code;

        if (typeof code !== "string" || !code) {
            return res.status(400).json({
                success: false,
                error: "Google authorization code is missing",
            });
        }

        const { token } = await authenticateWithGoogle(code);

        const isProduction = process.env.NODE_ENV === "production";

        res.cookie("access_token", token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return res.redirect(
            `${process.env.FRONTEND_URL ?? "http://localhost:5173"}/dashboard`,
        );
    } catch (error) {
        console.error("Google OAuth callback error:", error);

        return res.status(500).json({
            success: false,
            error: "Google authentication failed",
        });
    }
});

router.get(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: {
          id: req.userId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      return res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      console.error("Get current user error:", error);

      return res.status(500).json({
        success: false,
        error: "Failed to get current user",
      });
    }
  },
);

router.post("/logout", (_req, res) => {
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite:
      process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  return res.json({
    success: true,
    message: "Logged out successfully",
  });
});

export default router;