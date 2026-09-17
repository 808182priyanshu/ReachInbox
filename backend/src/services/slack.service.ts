import { prisma } from "../lib/prisma.js";
import jwt from "jsonwebtoken";

const slackClientId = process.env.SLACK_CLIENT_ID;
const slackClientSecret = process.env.SLACK_CLIENT_SECRET;
const slackRedirectUri = process.env.SLACK_REDIRECT_URI;

function requireSlackConfig() {
  if (!slackClientId || !slackClientSecret || !slackRedirectUri) {
    throw new Error("Slack OAuth configuration is missing");
  }
}

function jwtSecret() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return process.env.JWT_SECRET;
}

export function createSlackState(userId: string): string {
  requireSlackConfig();
  return jwt.sign({ purpose: "slack-oauth", userId }, jwtSecret(), { expiresIn: "10m" });
}

export function consumeSlackState(state: string): string | null {
  try {
    const payload = jwt.verify(state, jwtSecret());
    if (typeof payload !== "object" || payload === null || payload.purpose !== "slack-oauth" || typeof payload.userId !== "string") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function getSlackAuthorizationUrl(state: string): string {
  requireSlackConfig();
  const params = new URLSearchParams({
    client_id: slackClientId!,
    scope: "chat:write,channels:read,groups:read",
    redirect_uri: slackRedirectUri!,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCode(code: string) {
  requireSlackConfig();
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: slackClientId!,
      client_secret: slackClientSecret!,
      code,
      redirect_uri: slackRedirectUri!,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true || typeof payload.access_token !== "string") {
    throw new Error("Slack authorization failed");
  }
  return payload;
}

export async function saveSlackConnection(userId: string, payload: Record<string, unknown>) {
  const team = typeof payload.team === "object" && payload.team !== null ? payload.team as Record<string, unknown> : {};
  const incomingWebhook = typeof payload.incoming_webhook === "object" && payload.incoming_webhook !== null
    ? payload.incoming_webhook as Record<string, unknown>
    : {};

  return prisma.slackConnection.upsert({
    where: { userId },
    update: {
      accessToken: String(payload.access_token),
      webhookUrl: typeof incomingWebhook.url === "string" ? incomingWebhook.url : null,
      webhookChannel: typeof incomingWebhook.channel === "string" ? incomingWebhook.channel : null,
      teamId: typeof team.id === "string" ? team.id : null,
      teamName: typeof team.name === "string" ? team.name : null,
    },
    create: {
      userId,
      accessToken: String(payload.access_token),
      webhookUrl: typeof incomingWebhook.url === "string" ? incomingWebhook.url : null,
      webhookChannel: typeof incomingWebhook.channel === "string" ? incomingWebhook.channel : null,
      teamId: typeof team.id === "string" ? team.id : null,
      teamName: typeof team.name === "string" ? team.name : null,
    },
    select: {
      id: true,
      webhookChannel: true,
      teamId: true,
      teamName: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getSlackStatus(userId: string) {
  return prisma.slackConnection.findUnique({
    where: { userId },
    select: { id: true, webhookChannel: true, teamId: true, teamName: true, createdAt: true, updatedAt: true },
  });
}

export async function disconnectSlack(userId: string) {
  await prisma.slackConnection.deleteMany({ where: { userId } });
}

export async function notifyRateLimit(userId: string, senderName: string) {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) return false;

  const text = `ReachInbox rate limit reached for sender ${senderName}. Emails have been rescheduled to the next available window.`;

  try {
    if (connection.webhookUrl) {
      const response = await fetch(connection.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`Slack webhook returned ${response.status}`);
      return true;
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: connection.webhookChannel ?? connection.teamId,
        text,
      }),
    });
    const payload = (await response.json()) as { ok?: boolean };
    if (!response.ok || payload.ok !== true) throw new Error("Slack notification failed");
    return true;
  } catch (error) {
    console.error("Slack notification warning:", error instanceof Error ? error.message : error);
    return false;
  }
}
