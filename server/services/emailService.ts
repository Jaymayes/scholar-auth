import * as postmark from 'postmark';

class EmailService {
  private client: postmark.ServerClient;

  constructor() {
    const apiToken = process.env.POSTMARK_API_TOKEN;
    if (!apiToken) {
      console.warn('⚠️  POSTMARK_API_TOKEN not set - email sending will fail');
      this.client = new postmark.ServerClient('dummy-token-for-dev');
    } else {
      this.client = new postmark.ServerClient(apiToken);
    }
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ScholarshipAI</h1>
        </div>
        <div style="padding: 30px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-bottom: 20px;">Verify Your Email Address</h2>
          <p style="color: #475569; font-size: 16px; line-height: 1.5;">
            Please use the following verification code to complete your registration:
          </p>
          <div style="background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <div style="font-size: 32px; font-weight: bold; color: #3B82F6; letter-spacing: 4px;">${code}</div>
          </div>
          <p style="color: #64748b; font-size: 14px;">
            This code will expire in 15 minutes. If you didn't request this verification, please ignore this email.
          </p>
        </div>
        <div style="padding: 20px; text-align: center; background-color: #e2e8f0; font-size: 12px; color: #64748b;">
          © 2024 ScholarshipAI. All rights reserved.
        </div>
      </div>
    `;

    try {
      const result = await this.client.sendEmail({
        From: process.env.FROM_EMAIL || 'noreply@scholarshipai.com',
        To: email,
        Subject: 'ScholarshipAI - Email Verification',
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
        TrackOpens: false,
      });
      console.log(`✅ Verification email sent via Postmark: ${result.MessageID}`);
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/auth/reset-password?token=${token}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ScholarshipAI</h1>
        </div>
        <div style="padding: 30px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-bottom: 20px;">Reset Your Password</h2>
          <p style="color: #475569; font-size: 16px; line-height: 1.5;">
            You requested a password reset for your ScholarshipAI account. Click the button below to reset your password:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #3B82F6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
              Reset Password
            </a>
          </div>
          <p style="color: #64748b; font-size: 14px;">
            This link will expire in 15 minutes. If you didn't request a password reset, please ignore this email.
          </p>
          <p style="color: #64748b; font-size: 12px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <span style="word-break: break-all;">${resetUrl}</span>
          </p>
        </div>
        <div style="padding: 20px; text-align: center; background-color: #e2e8f0; font-size: 12px; color: #64748b;">
          © 2024 ScholarshipAI. All rights reserved.
        </div>
      </div>
    `;

    try {
      const result = await this.client.sendEmail({
        From: process.env.FROM_EMAIL || 'noreply@scholarshipai.com',
        To: email,
        Subject: 'ScholarshipAI - Password Reset',
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
        TrackOpens: false,
      });
      console.log(`✅ Password reset email sent via Postmark: ${result.MessageID}`);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  async sendParentVerificationEmail(
    email: string, 
    options: { 
      parentName: string; 
      childUserId: string; 
      verificationUrl: string 
    }
  ): Promise<void> {
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ScholarshipAI</h1>
        </div>
        <div style="padding: 30px; background-color: #f8fafc;">
          <h2 style="color: #1e293b; margin-bottom: 20px;">Verify Your Identity</h2>
          <p style="color: #475569; font-size: 16px; line-height: 1.5;">
            Dear ${options.parentName},
          </p>
          <p style="color: #475569; font-size: 16px; line-height: 1.5;">
            You've been registered as a parent/guardian for a child account (ID: ${options.childUserId}) on ScholarshipAI. 
            To comply with COPPA (Children's Online Privacy Protection Act), we need to verify your identity before you can 
            provide consent for your child's account.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${options.verificationUrl}" style="background: #3B82F6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
              Verify My Identity
            </a>
          </div>
          <p style="color: #64748b; font-size: 14px;">
            This verification link will expire in 24 hours. If you didn't register for this, please ignore this email.
          </p>
          <p style="color: #64748b; font-size: 12px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <span style="word-break: break-all;">${options.verificationUrl}</span>
          </p>
        </div>
        <div style="padding: 20px; text-align: center; background-color: #e2e8f0; font-size: 12px; color: #64748b;">
          © 2025 ScholarshipAI. All rights reserved.
        </div>
      </div>
    `;

    if (process.env.NODE_ENV === 'development' && !process.env.POSTMARK_API_TOKEN) {
      console.log('📧 [DEV MODE] Parent verification email would be sent to:', email);
      console.log('   Verification URL:', options.verificationUrl);
      console.log('   Parent Name:', options.parentName);
      return;
    }

    try {
      const result = await this.client.sendEmail({
        From: process.env.FROM_EMAIL || 'noreply@scholarshipai.com',
        To: email,
        Subject: 'ScholarshipAI - Verify Your Identity for COPPA Consent',
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
        TrackOpens: false,
      });
      console.log(`✅ Parent verification email sent via Postmark: ${result.MessageID}`);
    } catch (error) {
      console.error('Failed to send parent verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }
}

export const emailService = new EmailService();
