import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Users, AlertTriangle, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function ParentConsent() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="w-full max-w-2xl space-y-6">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-3xl font-bold">Parental Consent Required</CardTitle>
            <p className="text-gray-600 dark:text-gray-400">
              To comply with COPPA regulations, we need parental consent before users under 13 can access our services.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="font-medium">
                Your account is currently in restricted mode until parental consent is verified.
              </AlertDescription>
            </Alert>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center">
                <Users className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
                What happens next?
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li>A parent or guardian must create an account and verify their identity</li>
                <li>They will provide consent for your account through secure verification</li>
                <li>Once verified, your account will be unlocked with appropriate protections</li>
              </ol>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold">Available Parental Consent Methods:</h3>
              
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-2 border-dashed border-gray-300 dark:border-gray-600">
                  <CardContent className="p-4 text-center">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-3">
                      <ExternalLink className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <h4 className="font-medium mb-2">Online Verification</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Government ID and selfie verification
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled
                      data-testid="button-online-verification"
                    >
                      Coming Soon
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-2 border-dashed border-gray-300 dark:border-gray-600">
                  <CardContent className="p-4 text-center">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h4 className="font-medium mb-2">Signed Form</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Print, sign, and upload consent form
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled
                      data-testid="button-signed-form"
                    >
                      Coming Soon
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Alert>
              <AlertDescription>
                <strong>Parents:</strong> Visit our parent portal to complete the verification process. 
                You'll need to provide proof of identity and confirm your relationship to the user.
              </AlertDescription>
            </Alert>

            <div className="text-center pt-4 border-t">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Questions about the parental consent process?
              </p>
              <Button 
                variant="outline" 
                size="sm"
                data-testid="button-contact-support"
              >
                Contact Support
              </Button>
            </div>
          </CardContent>
        </Card>

        {user && (
          <Card className="bg-gray-50 dark:bg-gray-800">
            <CardContent className="p-4">
              <h3 className="font-medium mb-2">Account Status</h3>
              <div className="text-sm space-y-1">
                <p><strong>User:</strong> {user.firstName} {user.lastName}</p>
                <p><strong>Email:</strong> {user.email}</p>
                <p><strong>Status:</strong> <span className="text-amber-600 dark:text-amber-400">Restricted - Awaiting Parental Consent</span></p>
                <p><strong>Age Gate Status:</strong> {user.ageGateStatus || 'Pending'}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}