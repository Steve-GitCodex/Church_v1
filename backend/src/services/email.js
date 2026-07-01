import { Resend } from 'resend'
import { env } from '../config/env.js'

const resend = new Resend(env.resend.apiKey)

// ── Shared layout wrapper ─────────────────────────────────────────────────────

function layout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1a5276;padding:28px 40px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">
              <span style="color:#f39c12;">AIC</span> Ruiru
            </p>
            <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.65);">Member Portal</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #e9ecef;">
            <p style="margin:0;font-size:11px;color:#999;text-align:center;">
              AIC Ruiru &mdash; Ruiru, Kenya<br>
              This is an automated message. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── Email functions ───────────────────────────────────────────────────────────

export async function sendOtpEmail(to, otp) {
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: 'Your AIC Ruiru verification code',
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a5276;">Verify your account</h2>
      <p style="margin:0 0 28px;color:#666;font-size:14px;line-height:1.6;">
        Use the code below to complete your registration. It expires in <strong>10 minutes</strong>.
      </p>
      <div style="background:#f4f6f9;border-radius:8px;padding:24px;text-align:center;margin-bottom:28px;">
        <p style="margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Verification code</p>
        <p style="margin:0;font-size:36px;font-weight:700;letter-spacing:0.3em;color:#1a5276;">${otp}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
        If you didn't request this, you can safely ignore this email.
        Someone may have entered your address by mistake.
      </p>
    `),
  })
}

export async function sendAdminNewMemberNotification(to, firstName, lastName) {
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: 'New member pending approval — AIC Ruiru',
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a5276;">New member registration</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">
        A new member has completed registration and is awaiting your approval.
      </p>
      <div style="background:#f4f6f9;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1a5276;">${firstName} ${lastName}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#666;">Pending admin approval</p>
      </div>
      <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
        Log in to the admin portal to review and approve or reject this registration.
      </p>
    `),
  })
}

export async function sendApprovalEmail(to, firstName) {
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: 'Welcome to AIC Ruiru — Membership approved',
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a5276;">You're approved! 🎉</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">
        Dear <strong>${firstName}</strong>,
      </p>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">
        Your membership at AIC Ruiru has been approved. You can now log in to the member portal
        to view your profile, giving records, and upcoming events.
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${env.frontendUrl}/pages/login.html"
           style="display:inline-block;background:#1a5276;color:#ffffff;text-decoration:none;
                  padding:12px 32px;border-radius:6px;font-weight:700;font-size:14px;">
          Log in to Member Portal
        </a>
      </div>
      <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
        God bless you as you journey with us.
      </p>
    `),
  })
}

export async function sendPasswordResetEmail(to, firstName, otp) {
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: 'AIC Ruiru — Password reset code',
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a5276;">Reset your password</h2>
      <p style="margin:0 0 8px;color:#666;font-size:14px;line-height:1.6;">
        Dear <strong>${firstName}</strong>,
      </p>
      <p style="margin:0 0 28px;color:#666;font-size:14px;line-height:1.6;">
        Use the code below to reset your password. It expires in <strong>10 minutes</strong>.
      </p>
      <div style="background:#f4f6f9;border-radius:8px;padding:24px;text-align:center;margin-bottom:28px;">
        <p style="margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Reset code</p>
        <p style="margin:0;font-size:36px;font-weight:700;letter-spacing:0.3em;color:#1a5276;">${otp}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
        If you didn't request a password reset, you can safely ignore this email.
        Your password will not be changed.
      </p>
    `),
  })
}

export async function sendInviteEmail(to, token, frontendUrl) {
  const link = `${frontendUrl}/pages/register.html?invite=${token}`
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: 'You\'ve been invited to join AIC Ruiru',
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a5276;">You're personally invited</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">
        You have been personally invited to join the AIC Ruiru member portal.
        Click the button below to complete your registration.
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${link}"
           style="display:inline-block;background:#1a5276;color:#ffffff;text-decoration:none;
                  padding:12px 32px;border-radius:6px;font-weight:700;font-size:14px;">
          Accept Invitation
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#999;line-height:1.6;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0;font-size:12px;color:#1a5276;word-break:break-all;">${link}</p>
    `),
  })
}

export async function sendSecurityAlertEmail(to, title, body) {
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: `Security alert — ${title}`,
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#c0392b;">Security finding: ${title}</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;white-space:pre-wrap;">${body}</p>
      <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
        This alert was generated by a security review of the AIC Ruiru codebase. Review and remediate as needed.
      </p>
    `),
  })
}

export async function sendRejectionEmail(to, firstName) {
  await resend.emails.send({
    from: env.resend.from,
    to,
    subject: 'AIC Ruiru — Membership application update',
    html: layout(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a5276;">Membership application update</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">
        Dear <strong>${firstName}</strong>,
      </p>
      <p style="margin:0 0 24px;color:#666;font-size:14px;line-height:1.6;">
        We were unable to approve your membership registration at this time.
        Please contact the church office for further assistance.
      </p>
      <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
        We appreciate your interest in joining AIC Ruiru and hope to connect with you soon.
      </p>
    `),
  })
}
