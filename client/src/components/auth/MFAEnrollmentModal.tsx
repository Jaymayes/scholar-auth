import { useState, lazy, Suspense } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Shield, Smartphone, Key, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';

interface MFAEnrollmentModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type EnrollmentStep = 'choose' | 'totp-setup' | 'totp-verify' | 'webauthn' | 'complete';

export function MFAEnrollmentModal({ open, onClose, onComplete }: MFAEnrollmentModalProps) {
  const [step, setStep] = useState<EnrollmentStep>('choose');
  const [selectedMethod, setSelectedMethod] = useState<'totp' | 'webauthn' | null>(null);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrCode, setTotpQrCode] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [error, setError] = useState('');
  const [enrollmentStartTime] = useState(Date.now());

  const queryClient = useQueryClient();

  const startEnrollmentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/mfa/enrollment/start', {});
      return res.json();
    },
    onSuccess: () => {
      setStep('choose');
    },
  });

  const generateTotpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/mfa/totp/generate', {});
      return res.json();
    },
    onSuccess: (response: any) => {
      // API returns { success: true, data: { secret, qrCode, ... } }
      const data = response.data || response;
      setTotpSecret(data.secret);
      setTotpQrCode(data.qrCode);
      setStep('totp-verify');
      setError('');
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to generate authenticator setup');
    },
  });

  const verifyTotpMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await apiRequest('POST', '/api/mfa/totp/verify', {
        secret: totpSecret,
        token,
        label: 'Authenticator App',
      });
      return res.json();
    },
    onSuccess: () => {
      setStep('complete');
      queryClient.invalidateQueries({ queryKey: ['/api/mfa/status'] });
      setTimeout(() => {
        onComplete();
        onClose();
      }, 2000);
    },
    onError: (err: any) => {
      setError(err.message || 'Invalid verification code. Please try again.');
    },
  });

  const webauthnEnrollMutation = useMutation({
    mutationFn: async () => {
      const optionsRes = await apiRequest('POST', '/api/mfa/webauthn/generate-options', {
        label: 'Security Key',
      });
      const optionsResponse = await optionsRes.json();

      const registrationResponse = await startRegistration(optionsResponse.options);

      const verifyRes = await apiRequest('POST', '/api/mfa/webauthn/verify', {
        challengeId: optionsResponse.challengeId,
        response: registrationResponse,
        label: 'Security Key',
      });
      return verifyRes.json();
    },
    onSuccess: () => {
      setStep('complete');
      queryClient.invalidateQueries({ queryKey: ['/api/mfa/status'] });
      setTimeout(() => {
        onComplete();
        onClose();
      }, 2000);
    },
    onError: (err: any) => {
      setError(err.message || 'WebAuthn enrollment failed. Please try again.');
    },
  });

  const skipMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest('POST', '/api/mfa/decisions/skip', {
        reason: reason || 'User chose to skip enrollment',
      });
      return res.json();
    },
    onSuccess: () => {
      onClose();
    },
  });

  const handleChooseTotp = () => {
    setSelectedMethod('totp');
    setStep('totp-setup');
    setError('');
    generateTotpMutation.mutate();
  };

  const handleChooseWebAuthn = () => {
    setSelectedMethod('webauthn');
    setStep('webauthn');
    setError('');
    webauthnEnrollMutation.mutate();
  };

  const handleVerifyTotp = () => {
    if (totpToken.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setError('');
    verifyTotpMutation.mutate(totpToken);
  };

  const handleSkip = () => {
    skipMutation.mutate(skipReason);
  };

  const renderChooseMethod = () => (
    <div className="space-y-4">
      <DialogDescription>
        Enhance your account security by setting up multi-factor authentication. Choose your preferred method:
      </DialogDescription>

      <div className="grid gap-4">
        <Card 
          className="cursor-pointer hover:border-primary transition-colors" 
          onClick={handleChooseTotp}
          data-testid="card-totp-method"
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <Smartphone className="h-6 w-6 text-primary" />
              <CardTitle className="text-lg">Authenticator App</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Use an app like Google Authenticator, Authy, or 1Password to generate verification codes.
            </CardDescription>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:border-primary transition-colors" 
          onClick={handleChooseWebAuthn}
          data-testid="card-webauthn-method"
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <Key className="h-6 w-6 text-primary" />
              <CardTitle className="text-lg">Security Key</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Use a hardware security key like YubiKey or built-in biometric authentication.
            </CardDescription>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive" data-testid="alert-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="border-t pt-4 mt-4">
        <Label htmlFor="skip-reason" className="text-sm text-muted-foreground">
          Want to set this up later?
        </Label>
        <Input
          id="skip-reason"
          placeholder="Optional: Tell us why you're skipping"
          value={skipReason}
          onChange={(e) => setSkipReason(e.target.value)}
          className="mt-2"
          data-testid="input-skip-reason"
        />
        <Button 
          variant="outline" 
          onClick={handleSkip} 
          className="mt-2 w-full" 
          disabled={skipMutation.isPending}
          data-testid="button-skip"
        >
          {skipMutation.isPending ? 'Skipping...' : 'Skip for now'}
        </Button>
      </div>
    </div>
  );

  const renderTotpSetup = () => (
    <div className="space-y-4">
      <DialogDescription>
        Scan this QR code with your authenticator app, then enter the verification code below.
      </DialogDescription>

      {generateTotpMutation.isPending ? (
        <div className="flex items-center justify-center py-8" data-testid="loader-totp">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : totpQrCode ? (
        <div className="flex flex-col items-center space-y-4">
          <img 
            src={totpQrCode} 
            alt="TOTP QR Code" 
            className="border rounded-lg p-4"
            data-testid="img-qr-code"
          />
          <div className="text-xs text-muted-foreground text-center">
            Can't scan? Manual entry key: <code className="bg-muted px-1 py-0.5 rounded">{totpSecret}</code>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="totp-token">Verification Code</Label>
        <Input
          id="totp-token"
          placeholder="000000"
          value={totpToken}
          onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
          maxLength={6}
          className="text-center text-2xl tracking-widest"
          data-testid="input-totp-code"
        />
      </div>

      {error && (
        <Alert variant="destructive" data-testid="alert-totp-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button 
          variant="outline" 
          onClick={() => setStep('choose')} 
          className="flex-1"
          data-testid="button-back"
        >
          Back
        </Button>
        <Button 
          onClick={handleVerifyTotp} 
          disabled={totpToken.length !== 6 || verifyTotpMutation.isPending} 
          className="flex-1"
          data-testid="button-verify-totp"
        >
          {verifyTotpMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify & Enable'
          )}
        </Button>
      </div>
    </div>
  );

  const renderWebAuthn = () => (
    <div className="space-y-4">
      <DialogDescription>
        Follow your browser's prompts to register your security key or biometric authentication.
      </DialogDescription>

      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        {webauthnEnrollMutation.isPending ? (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary" data-testid="loader-webauthn" />
            <p className="text-sm text-muted-foreground">Waiting for your security key...</p>
          </>
        ) : null}
      </div>

      {error && (
        <Alert variant="destructive" data-testid="alert-webauthn-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button 
        variant="outline" 
        onClick={() => setStep('choose')} 
        className="w-full"
        disabled={webauthnEnrollMutation.isPending}
        data-testid="button-webauthn-back"
      >
        Back
      </Button>
    </div>
  );

  const renderComplete = () => (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div className="rounded-full bg-green-100 dark:bg-green-900 p-3">
          <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" data-testid="icon-success" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="font-semibold text-lg">All Set!</h3>
          <p className="text-sm text-muted-foreground">
            Your account is now protected with multi-factor authentication.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px]" data-testid="modal-mfa-enrollment">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <DialogTitle>Secure Your Account</DialogTitle>
          </div>
        </DialogHeader>

        {step === 'choose' && renderChooseMethod()}
        {(step === 'totp-setup' || step === 'totp-verify') && renderTotpSetup()}
        {step === 'webauthn' && renderWebAuthn()}
        {step === 'complete' && renderComplete()}
      </DialogContent>
    </Dialog>
  );
}
