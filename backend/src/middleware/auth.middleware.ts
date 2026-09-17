import "dotenv/config";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
}

export interface AuthenticatedRequest extends Request {
    userId?: string;
}

export function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    try {
        const token = req.cookies?.access_token;

        if (!token) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }

        const decoded = jwt.verify(token, jwtSecret as string);

        if (
            typeof decoded !== "object" ||
            decoded === null ||
            typeof decoded.userId !== "string"
        ) {
            return res.status(401).json({
                success: false,
                error: "Invalid authentication token",
            });
        }

        req.userId = decoded.userId;

        next();
    } catch {
        return res.status(401).json({
            success: false,
            error: "Invalid or expired authentication token",
        });
    }
}