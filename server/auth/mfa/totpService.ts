import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { storage } from '../../storage';
import type { User } from '@shared/schema';

export interface TotpGenerationResult {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
  label: string;
}

export interface TotpVerificationResult {
  verified: boolean;
  delta?: number;
}

export class TotpService {
  private readonly APP_NAME = 'Scholarship AI';
  private readonly WINDOW_SIZE = 2;

  async generateSecret(user: User, label: string = 'Authenticator App'): Promise<TotpGenerationResult> {
    const secret = speakeasy.generateSecret({
      name: `${this.APP_NAME} (${user.email})`,
      issuer: this.APP_NAME,
      length: 32,
    });

    if (!secret.otpauth_url) {
      throw new Error('Failed to generate OTPAuth URL');
    }

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    return {
      secret: secret.base32,
      qrCode,
      otpauthUrl: secret.otpauth_url,
      label,
    };
  }

  verifyToken(secret: string, token: string): TotpVerificationResult {
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: this.WINDOW_SIZE,
    });

    return {
      verified: typeof verified === 'number' || verified === true,
      delta: typeof verified === 'number' ? verified : undefined,
    };
  }

  async enrollFactor(
    userId: string,
    secret: string,
    token: string,
    label: string = 'Authenticator App'
  ): Promise<{ success: boolean; factorId?: string; error?: string }> {
    const verification = this.verifyToken(secret, token);

    if (!verification.verified) {
      return {
        success: false,
        error: 'Invalid verification code. Please try again.',
      };
    }

    try {
      const factor = await storage.createMfaFactor({
        userId,
        type: 'totp',
        label,
        secretOrCredential: { secret },
        status: 'active',
      });

      return {
        success: true,
        factorId: factor.id,
      };
    } catch (error) {
      console.error('Failed to enroll TOTP factor:', error);
      return {
        success: false,
        error: 'Failed to save authentication method. Please try again.',
      };
    }
  }

  async verifyFactorToken(factorId: string, token: string): Promise<boolean> {
    const factor = await storage.getMfaFactor(factorId);

    if (!factor || factor.status !== 'active' || factor.type !== 'totp') {
      return false;
    }

    const secretData = factor.secretOrCredential as { secret: string };
    const verification = this.verifyToken(secretData.secret, token);

    if (verification.verified) {
      await storage.updateMfaFactorLastUsed(factorId);
      return true;
    }

    return false;
  }
}

export const totpService = new TotpService();
