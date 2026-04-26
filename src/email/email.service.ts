import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'));
    this.appUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  // ── Shared email wrapper ───────────────────────────
  private wrapInTemplate(content: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:40px 0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
          
          <!-- Brand header -->
          <div style="background-color:#0f172a;padding:24px 40px;text-align:center;">
            <span style="color:#22c55e;font-size:24px;font-weight:700;letter-spacing:-0.5px;">✦ Bookwise</span>
          </div>
          
          <!-- Green accent bar -->
          <div style="height:4px;background-color:#22c55e;"></div>
          
          <!-- Content -->
          <div style="padding:32px 40px;">
            ${content}
          </div>
          
          <!-- Footer -->
          <div style="border-top:1px solid #e2e8f0;padding:24px 40px;background-color:#f8fafc;">
            <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0;font-weight:500;">
              Bookwise — AI-powered booking for service businesses
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // ── Staff invitation email ─────────────────────────
  async sendInvitationEmail(
    to: string,
    orgName: string,
    inviteeName: string,
    role: string,
    token: string,
  ) {
    const inviteLink = `${this.appUrl}/invite/${token}`;

    const content = `
      <h2 style="color:#0f172a;font-size:24px;font-weight:700;margin:0 0 20px;">You're invited!</h2>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        Hi ${inviteeName},
      </p>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        You've been invited to join <strong style="color:#0f172a;">${orgName}</strong> 
        as <strong style="color:#0f172a;">${role}</strong> on Bookwise.
      </p>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        Accept the invitation below to set up your profile and start managing bookings.
      </p>
      
      <div style="text-align:center;margin:32px 0;">
        <a href="${inviteLink}" style="display:inline-block;background-color:#22c55e;border-radius:10px;color:#ffffff;font-size:15px;font-weight:600;padding:14px 36px;text-decoration:none;">
          Accept Invitation
        </a>
      </div>
      
      <div style="background-color:#f0fdf4;border-radius:10px;padding:14px 20px;border:1px solid #bbf7d0;text-align:center;">
        <p style="color:#16a34a;font-size:13px;font-weight:500;margin:0;">
          ⏰ This invitation expires in 48 hours
        </p>
      </div>
    `;

    try {
      await this.resend.emails.send({
        from: 'Bookwise <onboarding@resend.dev>',
        to,
        subject: `You've been invited to join ${orgName}`,
        html: this.wrapInTemplate(content),
      });

      this.logger.log(`Invitation email sent to: ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email to: ${to}`, error);
    }
  }

  // ── Booking confirmation email ─────────────────────
  async sendBookingConfirmationEmail(
    to: string,
    customerName: string,
    orgName: string,
    serviceName: string,
    staffName: string | null,
    date: string,
    time: string,
  ) {
    const content = `
      <div style="background-color:#f0fdf4;border-radius:100px;padding:10px 20px;text-align:center;margin:0 0 24px;border:1px solid #bbf7d0;display:inline-block;">
        <span style="color:#16a34a;font-size:14px;font-weight:600;">✓ Booking Confirmed</span>
      </div>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        Hi ${customerName},
      </p>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        Your appointment at <strong style="color:#0f172a;">${orgName}</strong> has been confirmed.
      </p>
      
      <div style="background-color:#f8fafc;border-radius:12px;padding:20px 24px;margin:24px 0;border:1px solid #e2e8f0;">
        <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">SERVICE:</span> ${serviceName}
        </p>
        <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">DATE:</span> ${date}
        </p>
        <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">TIME:</span> ${time}
        </p>
        ${
          staffName
            ? `
          <p style="margin:0;font-size:14px;color:#0f172a;">
            <span style="color:#94a3b8;font-weight:600;font-size:13px;">STAFF:</span> ${staffName}
          </p>
        `
            : ''
        }
      </div>
      
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin:24px 0 0;">
        Need to cancel or reschedule? Contact ${orgName} directly.
      </p>
    `;

    try {
      await this.resend.emails.send({
        from: 'Bookwise <onboarding@resend.dev>',
        to,
        subject: `Booking Confirmed — ${orgName}`,
        html: this.wrapInTemplate(content),
      });

      this.logger.log(`Booking confirmation sent to: ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send booking email to: ${to}`, error);
    }
  }

  // ── Booking status update email ────────────────────
  async sendBookingStatusEmail(
    to: string,
    customerName: string,
    orgName: string,
    serviceName: string,
    status: string,
    date: string,
    time: string,
  ) {
    const statusConfig: Record<
      string,
      { color: string; bg: string; border: string; message: string }
    > = {
      CONFIRMED: {
        color: '#16a34a',
        bg: '#f0fdf4',
        border: '#bbf7d0',
        message: 'Your booking has been confirmed!',
      },
      CANCELLED: {
        color: '#dc2626',
        bg: '#fef2f2',
        border: '#fecaca',
        message: 'Your booking has been cancelled.',
      },
      RESCHEDULED: {
        color: '#2563eb',
        bg: '#eff6ff',
        border: '#bfdbfe',
        message: 'Your booking has been rescheduled.',
      },
      COMPLETED: {
        color: '#22c55e',
        bg: '#f0fdf4',
        border: '#bbf7d0',
        message: 'Thank you for your visit!',
      },
      NO_SHOW: {
        color: '#f59e0b',
        bg: '#fffbeb',
        border: '#fde68a',
        message: 'We missed you at your appointment.',
      },
    };

    const config = statusConfig[status] || statusConfig.CONFIRMED;

    const content = `
      <div style="background-color:${config.bg};border-radius:10px;padding:14px 20px;text-align:center;margin:0 0 24px;border:1px solid ${config.border};">
        <p style="color:${config.color};font-size:15px;font-weight:600;margin:0;">
          ${config.message}
        </p>
      </div>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        Hi ${customerName},
      </p>
      
      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        Here's an update about your booking at <strong style="color:#0f172a;">${orgName}</strong>:
      </p>
      
      <div style="background-color:#f8fafc;border-radius:12px;padding:20px 24px;margin:24px 0;border:1px solid #e2e8f0;">
        <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">SERVICE:</span> ${serviceName}
        </p>
        <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">DATE:</span> ${date}
        </p>
        <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">TIME:</span> ${time}
        </p>
        <p style="margin:0;font-size:14px;color:#0f172a;">
          <span style="color:#94a3b8;font-weight:600;font-size:13px;">STATUS:</span> 
          <span style="color:${config.color};font-weight:600;">${status}</span>
        </p>
      </div>
      
      <p style="color:#94a3b8;font-size:13px;text-align:center;margin:24px 0 0;">
        Questions? Contact ${orgName} directly.
      </p>
    `;

    try {
      await this.resend.emails.send({
        from: 'Bookwise <onboarding@resend.dev>',
        to,
        subject: `Booking ${status.charAt(0) + status.slice(1).toLowerCase()} — ${orgName}`,
        html: this.wrapInTemplate(content),
      });

      this.logger.log(`Status email sent to: ${to} (${status})`);
    } catch (error) {
      this.logger.error(`Failed to send status email to: ${to}`, error);
    }
  }

  // ── Payment failed email ──────────────────────────
  async sendPaymentFailedEmail(
    to: string,
    orgName: string,
    billingUrl: string,
  ) {
    const content = `
      <div style="background-color:#fef2f2;border-radius:10px;padding:14px 20px;text-align:center;margin:0 0 24px;border:1px solid #fecaca;">
        <p style="color:#dc2626;font-size:15px;font-weight:600;margin:0;">⚠️ Payment Failed</p>
      </div>

      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        We were unable to process the payment for your
        <strong style="color:#0f172a;">${orgName}</strong> Bookwise subscription.
      </p>

      <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
        To keep your subscription active and avoid any service interruption, please update your payment method.
      </p>

      <div style="text-align:center;margin:32px 0;">
        <a href="${billingUrl}" style="display:inline-block;background-color:#22c55e;border-radius:10px;color:#ffffff;font-size:15px;font-weight:600;padding:14px 36px;text-decoration:none;">
          Update Payment Method
        </a>
      </div>

      <div style="background-color:#fef2f2;border-radius:10px;padding:14px 20px;border:1px solid #fecaca;">
        <p style="color:#dc2626;font-size:13px;font-weight:500;margin:0;text-align:center;">
          Your subscription may be paused if payment is not resolved.
        </p>
      </div>
    `;

    try {
      await this.resend.emails.send({
        from: 'Bookwise <onboarding@resend.dev>',
        to,
        subject: `Action Required: Payment failed for ${orgName}`,
        html: this.wrapInTemplate(content),
      });

      this.logger.log(`Payment failed email sent to: ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send payment failed email to: ${to}`, error);
    }
  }

  // ── Leave status email ─────────────────────────────
  async sendLeaveStatusEmail(
    to: string,
    staffName: string,
    startDate: string,
    endDate: string,
    status: string,
  ) {
    const statusConfig: Record<
      string,
      { color: string; bg: string; border: string; message: string }
    > = {
      APPROVED: {
        color: '#16a34a',
        bg: '#f0fdf4',
        border: '#bbf7d0',
        message: 'Your leave request has been approved!',
      },
      REJECTED: {
        color: '#dc2626',
        bg: '#fef2f2',
        border: '#fecaca',
        message: 'Your leave request has been rejected.',
      },
    };

    const config = statusConfig[status] || statusConfig.APPROVED;

    const content = `
    <div style="background-color:${config.bg};border-radius:10px;padding:14px 20px;text-align:center;margin:0 0 24px;border:1px solid ${config.border};">
      <p style="color:${config.color};font-size:15px;font-weight:600;margin:0;">
        ${config.message}
      </p>
    </div>
    
    <p style="color:#475569;font-size:15px;line-height:26px;margin:0 0 12px;">
      Hi ${staffName},
    </p>
    
    <div style="background-color:#f8fafc;border-radius:12px;padding:20px 24px;margin:24px 0;border:1px solid #e2e8f0;">
      <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
        <span style="color:#94a3b8;font-weight:600;font-size:13px;">FROM:</span> ${startDate}
      </p>
      <p style="margin:0 0 8px;font-size:14px;color:#0f172a;">
        <span style="color:#94a3b8;font-weight:600;font-size:13px;">TO:</span> ${endDate}
      </p>
      <p style="margin:0;font-size:14px;color:#0f172a;">
        <span style="color:#94a3b8;font-weight:600;font-size:13px;">STATUS:</span> 
        <span style="color:${config.color};font-weight:600;">${status}</span>
      </p>
    </div>
  `;

    try {
      await this.resend.emails.send({
        from: 'Bookwise <onboarding@resend.dev>',
        to,
        subject: `Leave Request ${status.charAt(0) + status.slice(1).toLowerCase()}`,
        html: this.wrapInTemplate(content),
      });

      this.logger.log(`Leave status email sent to: ${to} (${status})`);
    } catch (error) {
      this.logger.error(`Failed to send leave email to: ${to}`, error);
    }
  }
}
