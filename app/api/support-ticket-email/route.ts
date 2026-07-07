import { NextResponse } from "next/server";

const ADMIN_SUPPORT_EMAIL = "joeryan09@outlook.com";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);

  // TODO: Configure SUPPORT_EMAIL_WEBHOOK_URL or wire this route to a transactional
  // email provider such as Resend. Ticket creation must not depend on email setup.
  const webhookUrl = process.env.SUPPORT_EMAIL_WEBHOOK_URL;

  if (!webhookUrl) {
    return NextResponse.json({
      sent: false,
      reason: "Email service not configured. Ticket was saved; admin email notification skipped.",
      adminEmail: ADMIN_SUPPORT_EMAIL
    });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: ADMIN_SUPPORT_EMAIL,
        subject: `Fuel Bank Support Ticket ${payload?.ticket_number ?? ""}`.trim(),
        payload
      })
    });

    if (!response.ok) {
      return NextResponse.json({
        sent: false,
        reason: `Email webhook returned ${response.status}. Ticket was saved.`
      });
    }

    return NextResponse.json({ sent: true });
  } catch (error) {
    return NextResponse.json({
      sent: false,
      reason: error instanceof Error ? error.message : "Email notification failed. Ticket was saved."
    });
  }
}
