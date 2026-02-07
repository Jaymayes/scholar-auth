/**
 * 🚀 CEO DIRECTIVE (Nov 14, 2025): Enhanced Messaging Service
 * 
 * Multi-provider email + SMS service supporting:
 * - SendGrid (email - primary for auto_com_center)
 * - Postmark (email - fallback)
 * - Twilio (SMS - deadline reminders, MFA)
 * 
 * Budget Authorization: $1,500 SendGrid + $1,000 Twilio MRR
 */

import sgMail from '@sendgrid/mail';
import * as postmark from 'postmark';
import twilio from 'twilio';

// Email provider configuration
type EmailProvider = 'sendgrid' | 'postmark';

interface EmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
  from?: string;
  templateId?: string;
  dynamicData?: Record<string, any>;
}

interface SmsPayload {
  to: string; // E.164 format: +1234567890
  message: string;
}

class MessagingService {
  private sendGridClient: typeof sgMail | null = null;
  private postmarkClient: postmark.ServerClient | null = null;
  private twilioClient: twilio.Twilio | null = null;
  private emailProvider: EmailProvider;

  constructor() {
    // Initialize SendGrid if available (primary)
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.sendGridClient = sgMail;
      this.emailProvider = 'sendgrid';
      console.log('✅ SendGrid initialized (primary email provider)');
    } 
    // Fallback to Postmark
    else if (process.env.POSTMARK_API_TOKEN) {
      this.postmarkClient = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
      this.emailProvider = 'postmark';
      console.log('✅ Postmark initialized (fallback email provider)');
    } 
    else {
      console.warn('⚠️  No email provider configured - emails will fail');
      this.emailProvider = 'postmark';
      this.postmarkClient = new postmark.ServerClient('dummy-token');
    }

    // Initialize Twilio if available
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      console.log('✅ Twilio initialized (SMS provider)');
    } else {
      console.warn('⚠️  Twilio not configured - SMS sending disabled');
    }
  }

  /**
   * Send email via configured provider (SendGrid or Postmark)
   */
  async sendEmail(payload: EmailPayload): Promise<string> {
    const from = payload.from || process.env.FROM_EMAIL || 'noreply@scholaraiadvisor.com';

    try {
      if (this.emailProvider === 'sendgrid' && this.sendGridClient) {
        return await this.sendViaSendGrid(payload, from);
      } else if (this.emailProvider === 'postmark' && this.postmarkClient) {
        return await this.sendViaPostmark(payload, from);
      } else {
        throw new Error('No email provider available');
      }
    } catch (error: any) {
      console.error(`Email send failed via ${this.emailProvider}:`, error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  /**
   * SendGrid implementation (primary for auto_com_center)
   */
  private async sendViaSendGrid(payload: EmailPayload, from: string): Promise<string> {
    if (!this.sendGridClient) {
      throw new Error('SendGrid not initialized');
    }

    const msg: any = {
      to: payload.to,
      from: {
        email: from,
        name: 'ScholarshipAI',
      },
      subject: payload.subject,
      html: payload.htmlBody,
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true },
      },
    };

    // Use dynamic template if provided
    if (payload.templateId && payload.dynamicData) {
      msg.templateId = payload.templateId;
      msg.dynamicTemplateData = payload.dynamicData;
      delete msg.subject; // Subject comes from template
      delete msg.html;
    }

    const [response] = await this.sendGridClient.send(msg);
    const messageId = response.headers['x-message-id'] as string;
    console.log(`✅ Email sent via SendGrid: ${messageId}`);
    
    return messageId;
  }

  /**
   * Postmark implementation (fallback)
   */
  private async sendViaPostmark(payload: EmailPayload, from: string): Promise<string> {
    if (!this.postmarkClient) {
      throw new Error('Postmark not initialized');
    }

    const result = await this.postmarkClient.sendEmail({
      From: from,
      To: payload.to,
      Subject: payload.subject,
      HtmlBody: payload.htmlBody,
      MessageStream: 'outbound',
      TrackOpens: false,
    });

    console.log(`✅ Email sent via Postmark: ${result.MessageID}`);
    return result.MessageID;
  }

  /**
   * Send SMS via Twilio
   */
  async sendSms(payload: SmsPayload): Promise<string> {
    if (!this.twilioClient) {
      throw new Error('Twilio not configured - SMS sending disabled');
    }

    if (!process.env.TWILIO_PHONE_NUMBER) {
      throw new Error('TWILIO_PHONE_NUMBER not configured');
    }

    try {
      const message = await this.twilioClient.messages.create({
        body: payload.message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: payload.to,
      });

      console.log(`✅ SMS sent via Twilio: ${message.sid}`);
      return message.sid;
    } catch (error: any) {
      console.error('Twilio SMS error:', error);
      throw new Error(`Failed to send SMS: ${error.message}`);
    }
  }

  /**
   * Get service status for health checks
   */
  getStatus(): {
    email: { provider: EmailProvider; available: boolean };
    sms: { provider: string; available: boolean };
  } {
    return {
      email: {
        provider: this.emailProvider,
        available: this.sendGridClient !== null || this.postmarkClient !== null,
      },
      sms: {
        provider: 'twilio',
        available: this.twilioClient !== null,
      },
    };
  }

  /**
   * Send notification (email + SMS if phone number provided)
   * 
   * Used by auto_com_center for scholarship notifications
   */
  async sendNotification(data: {
    userId: string;
    email: string;
    phone?: string;
    subject: string;
    htmlBody: string;
    smsMessage?: string;
  }): Promise<{
    emailId?: string;
    smsId?: string;
  }> {
    const results: { emailId?: string; smsId?: string } = {};

    // Send email
    try {
      results.emailId = await this.sendEmail({
        to: data.email,
        subject: data.subject,
        htmlBody: data.htmlBody,
      });
    } catch (error) {
      console.error('Email notification failed:', error);
      // Don't throw - try SMS anyway
    }

    // Send SMS if phone provided and SMS message exists
    if (data.phone && data.smsMessage) {
      try {
        results.smsId = await this.sendSms({
          to: data.phone,
          message: data.smsMessage,
        });
      } catch (error) {
        console.error('SMS notification failed:', error);
        // Don't throw - partial success is acceptable
      }
    }

    return results;
  }
}

// Singleton instance
export const messagingService = new MessagingService();

/**
 * SMS Templates (env-driven, no hardcoded URLs)
 */
export const SMS_TEMPLATES = {
  deadlineReminder: (scholarshipName: string, days: number, baseUrl: string) =>
    `🎓 ${scholarshipName} deadline in ${days} days! Apply: ${baseUrl}`,

  newMatch: (count: number, baseUrl: string) =>
    `🎯 ${count} new scholarship matches! View: ${baseUrl}/matches`,

  mfaCode: (code: string) =>
    `ScholarshipAI MFA code: ${code}. Expires in 5 minutes.`,
};

/**
 * Email Templates (for SendGrid dynamic templates)
 * Template IDs stored in env vars (CEO directive: env-driven config)
 */
export const EMAIL_TEMPLATES = {
  scholarshipNewMatch: process.env.SENDGRID_TEMPLATE_NEW_MATCH || 'd-xxx',
  scholarshipDeadlineReminder: process.env.SENDGRID_TEMPLATE_DEADLINE || 'd-yyy',
  scholarshipStatusUpdate: process.env.SENDGRID_TEMPLATE_STATUS || 'd-zzz',
  welcomeStudent: process.env.SENDGRID_TEMPLATE_WELCOME || 'd-aaa',
  providerVerification: process.env.SENDGRID_TEMPLATE_PROVIDER_VERIFY || 'd-bbb',
} as const;
