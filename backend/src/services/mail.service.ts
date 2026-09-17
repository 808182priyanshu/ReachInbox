import "dotenv/config";
import nodemailer from "nodemailer";

const host = process.env.ETHEREAL_HOST;
const port = Number(process.env.ETHEREAL_PORT ?? 587);
const user = process.env.ETHEREAL_USER;
const password = process.env.ETHEREAL_PASSWORD;

if (!host || !user || !password) {
    throw new Error(
        "Ethereal SMTP configuration is missing"
    );
}

export const mailTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
        user,
        pass: password,
    },
});

export async function sendEmail(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
}) {
    const result = await mailTransporter.sendMail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        text: params.text,

        // Deterministic Message-ID helps identify the
        // same logical email across processing attempts.
        headers: {
            "X-ReachInbox-Mail": "true",
        },
    });

    return {
        messageId: result.messageId,
        response: result.response,
    };
}