import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server/script/deps';
import { storage } from '../../storage';
import type { User } from '@shared/schema';

export interface WebAuthnRegistrationOptions {
  options: PublicKeyCredentialCreationOptionsJSON;
  challengeId: string;
}

export interface WebAuthnAuthenticationOptions {
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
}

export class WebAuthnService {
  private readonly RP_NAME = 'Scholarship AI';
  private readonly RP_ID = this.getRpId();
  private readonly ORIGIN = this.getOrigin();
  private readonly CHALLENGE_TIMEOUT = 5 * 60 * 1000;

  private getRpId(): string {
    if (process.env.NODE_ENV === 'production') {
      return process.env.WEBAUTHN_RP_ID || 'scholarshipai.com';
    }
    return 'localhost';
  }

  private getOrigin(): string {
    if (process.env.NODE_ENV === 'production') {
      return process.env.WEBAUTHN_ORIGIN || 'https://scholarshipai.com';
    }
    return `http://localhost:${process.env.PORT || 5000}`;
  }

  async generateRegistrationOptions(
    user: User,
    label: string = 'Security Key'
  ): Promise<WebAuthnRegistrationOptions> {
    const existingFactors = await storage.getMfaFactorsByUser(user.id);
    const existingCredentials = existingFactors
      .filter((f) => f.type === 'webauthn')
      .map((f) => {
        const credData = f.secretOrCredential as { credentialId: string };
        return {
          id: Buffer.from(credData.credentialId, 'base64'),
          type: 'public-key' as const,
          transports: ['usb', 'ble', 'nfc', 'internal'] as AuthenticatorTransport[],
        };
      });

    const options = await generateRegistrationOptions({
      rpName: this.RP_NAME,
      rpID: this.RP_ID,
      userID: user.id,
      userName: user.email,
      userDisplayName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      attestationType: 'none',
      excludeCredentials: existingCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    const expiresAt = new Date(Date.now() + this.CHALLENGE_TIMEOUT);
    const challenge = await storage.createMfaChallenge({
      userId: user.id,
      factorId: undefined,
      type: 'webauthn',
      expiresAt,
      metadata: {
        challenge: options.challenge,
        type: 'registration',
      },
    });

    return {
      options,
      challengeId: challenge.id,
    };
  }

  async verifyRegistration(
    userId: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    label: string = 'Security Key'
  ): Promise<{ success: boolean; factorId?: string; error?: string }> {
    try {
      const challenge = await storage.getMfaChallenge(challengeId);

      if (!challenge || challenge.userId !== userId) {
        return { success: false, error: 'Invalid or expired challenge' };
      }

      if (challenge.consumedAt) {
        return { success: false, error: 'Challenge already used' };
      }

      if (new Date() > new Date(challenge.expiresAt)) {
        return { success: false, error: 'Challenge expired' };
      }

      const metadata = challenge.metadata as { challenge: string; type: string };
      const expectedChallenge = metadata.challenge;

      const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.ORIGIN,
        expectedRPID: this.RP_ID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return { success: false, error: 'Verification failed' };
      }

      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;

      const factor = await storage.createMfaFactor({
        userId,
        type: 'webauthn',
        label,
        secretOrCredential: {
          credentialId: Buffer.from(credentialID).toString('base64'),
          publicKey: Buffer.from(credentialPublicKey).toString('base64'),
          counter,
        },
        status: 'active',
      });

      await storage.consumeMfaChallenge(challengeId);

      return { success: true, factorId: factor.id };
    } catch (error) {
      console.error('WebAuthn registration verification failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  async generateAuthenticationOptions(userId: string): Promise<WebAuthnAuthenticationOptions> {
    const factors = await storage.getMfaFactorsByUser(userId);
    const webauthnFactors = factors.filter((f) => f.type === 'webauthn');

    const allowCredentials = webauthnFactors.map((f) => {
      const credData = f.secretOrCredential as { credentialId: string };
      return {
        id: Buffer.from(credData.credentialId, 'base64'),
        type: 'public-key' as const,
        transports: ['usb', 'ble', 'nfc', 'internal'] as AuthenticatorTransport[],
      };
    });

    const options = await generateAuthenticationOptions({
      rpID: this.RP_ID,
      allowCredentials,
      userVerification: 'preferred',
    });

    const expiresAt = new Date(Date.now() + this.CHALLENGE_TIMEOUT);
    const challenge = await storage.createMfaChallenge({
      userId,
      factorId: undefined,
      type: 'webauthn',
      expiresAt,
      metadata: {
        challenge: options.challenge,
        type: 'authentication',
      },
    });

    return {
      options,
      challengeId: challenge.id,
    };
  }

  async verifyAuthentication(
    userId: string,
    challengeId: string,
    response: AuthenticationResponseJSON
  ): Promise<{ success: boolean; factorId?: string; error?: string }> {
    try {
      const challenge = await storage.getMfaChallenge(challengeId);

      if (!challenge || challenge.userId !== userId) {
        return { success: false, error: 'Invalid or expired challenge' };
      }

      if (challenge.consumedAt) {
        return { success: false, error: 'Challenge already used' };
      }

      if (new Date() > new Date(challenge.expiresAt)) {
        return { success: false, error: 'Challenge expired' };
      }

      const credentialId = Buffer.from(response.id, 'base64url').toString('base64');
      const factors = await storage.getMfaFactorsByUser(userId);
      const factor = factors.find((f) => {
        if (f.type !== 'webauthn') return false;
        const credData = f.secretOrCredential as { credentialId: string };
        return credData.credentialId === credentialId;
      });

      if (!factor) {
        return { success: false, error: 'Credential not found' };
      }

      const credData = factor.secretOrCredential as {
        credentialId: string;
        publicKey: string;
        counter: number;
      };

      const metadata = challenge.metadata as { challenge: string; type: string };
      const expectedChallenge = metadata.challenge;

      const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.ORIGIN,
        expectedRPID: this.RP_ID,
        authenticator: {
          credentialID: Buffer.from(credData.credentialId, 'base64'),
          credentialPublicKey: Buffer.from(credData.publicKey, 'base64'),
          counter: credData.counter,
        },
      });

      if (!verification.verified) {
        return { success: false, error: 'Verification failed' };
      }

      await storage.consumeMfaChallenge(challengeId);
      await storage.updateMfaFactorLastUsed(factor.id);

      return { success: true, factorId: factor.id };
    } catch (error) {
      console.error('WebAuthn authentication verification failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }
}

export const webauthnService = new WebAuthnService();
