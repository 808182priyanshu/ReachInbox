import "dotenv/config";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL;
const jwtSecret = process.env.JWT_SECRET;

if (
    !googleClientId ||
    !googleClientSecret ||
    !googleCallbackUrl ||
    !jwtSecret
) {
    throw new Error("Google OAuth or JWT configuration is missing");
}

export const googleClient = new OAuth2Client(
    googleClientId,
    googleClientSecret,
    googleCallbackUrl,
);

export function getGoogleAuthUrl(): string {
    return googleClient.generateAuthUrl({
        access_type: "offline",
        scope: ["openid", "email", "profile"],
        prompt: "select_account",
    });
}

export async function authenticateWithGoogle(
    code: string,
) {
    const { tokens } = await googleClient.getToken(code);

    if (!tokens.id_token) {
        throw new Error("Google did not return an ID token");
    }

    const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: googleClientId,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
        throw new Error("Google account information is incomplete");
    }

    const name =
        payload.name ||
        payload.email.split("@")[0] ||
        "ReachInbox User";

    const user = await prisma.user.upsert({
        where: {
            googleId: payload.sub,
        },
        update: {
            email: payload.email,
            name,
            avatarUrl: payload.picture ?? null,
        },
        create: {
            googleId: payload.sub,
            email: payload.email,
            name,
            avatarUrl: payload.picture ?? null,
        },
    });
    const token = jwt.sign(
    {
        userId: user.id,
        email: user.email,
    },
    jwtSecret as string,
    {
        expiresIn: "7d",
    },
    );

    return {
        user,
        token,
    };
}