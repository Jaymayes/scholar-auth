import { Shield, Cookie, Clock, Users, Mail, FileText, MapPin, Phone, Globe, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";

const BRAND_NAME = "Scholar AI Advisor";
const COMPANY_LEGAL_NAME = "Referral Service LLC";
const MAIN_SITE_URL = "https://scholaraiadvisor.com";
const APP_BASE_URL = "https://scholar-auth-jamarrlmayes.replit.app";
const APP_NAME = "scholar_auth";
const CONTACT_EMAIL = "support@referralsvc.com";
const CONTACT_PHONE = "602-796-0177";
const CONTACT_ADDRESS = "16031 N 171st Ln, Surprise, AZ 85388, USA";
const EFFECTIVE_DATE = "2025-12-01";

export default function Privacy() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": COMPANY_LEGAL_NAME,
    "alternateName": BRAND_NAME,
    "url": MAIN_SITE_URL,
    "email": CONTACT_EMAIL,
    "telephone": CONTACT_PHONE,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "16031 N 171st Ln",
      "addressLocality": "Surprise",
      "addressRegion": "AZ",
      "postalCode": "85388",
      "addressCountry": "US"
    },
    "sameAs": [MAIN_SITE_URL]
  };

  return (
    <>
      <SEO 
        title={`Privacy Policy | ${BRAND_NAME} – ${APP_NAME}`}
        description={`Privacy Policy for ${BRAND_NAME} by ${COMPANY_LEGAL_NAME}. Learn how we collect, use, and protect your personal information.`}
        canonicalPath="/privacy"
        schema={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-primary text-primary-foreground px-4 py-2 rounded z-50" data-testid="link-skip-to-content">
          Skip to main content
        </a>
        
        <main id="main-content" role="main" aria-label="Privacy Policy">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-foreground mb-2" data-testid="text-privacy-title">
                Privacy Policy
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="text-effective-date">
                Effective Date: {EFFECTIVE_DATE}
              </p>
            </div>

            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <Globe className="w-8 h-8 text-primary flex-shrink-0 mt-1" aria-hidden="true" />
                  <div>
                    <h2 className="text-xl font-semibold text-foreground mb-2">Who We Are</h2>
                    <p className="text-foreground leading-relaxed">
                      {BRAND_NAME} is provided by {COMPANY_LEGAL_NAME} ("we," "us," "our") operating at{" "}
                      <a href={MAIN_SITE_URL} className="text-primary hover:underline" data-testid="link-main-site">{MAIN_SITE_URL}</a> and 
                      this app at <a href={APP_BASE_URL} className="text-primary hover:underline" data-testid="link-app-site">{APP_BASE_URL}</a>.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardContent className="pt-6">
                <h2 className="text-xl font-semibold text-foreground mb-2">What We Do</h2>
                <p className="text-muted-foreground">
                  We help students and providers discover, manage, and apply for scholarships using AI-enabled tools.
                  This app ({APP_NAME}) provides secure authentication services, and credentials are used 
                  exclusively for authentication and security purposes.
                </p>
              </CardContent>
            </Card>

            <section className="mb-8" aria-labelledby="collection-heading">
              <div className="flex items-center mb-4">
                <FileText className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="collection-heading" className="text-2xl font-semibold text-foreground" data-testid="section-data-collection">
                  Information We Collect
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Account and Profile Data</h3>
                    <p className="text-muted-foreground">
                      Information that users provide (name, email, school/academic info needed for scholarship matching).
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Usage and Device Data</h3>
                    <p className="text-muted-foreground">
                      Log files, cookies, and analytics to understand how you interact with our platform.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Payment and Transaction Data</h3>
                    <p className="text-muted-foreground">
                      When credits or services are purchased; payments are processed by third-party processors.
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Provider Data</h3>
                    <p className="text-muted-foreground">
                      Data submitted to list or manage scholarships.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="usage-heading">
              <div className="flex items-center mb-4">
                <Shield className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="usage-heading" className="text-2xl font-semibold text-foreground">
                  How We Use Data
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Deliver and improve services</li>
                    <li>• Personalize recommendations</li>
                    <li>• Provide customer support</li>
                    <li>• Process transactions</li>
                    <li>• Detect and prevent fraud/abuse</li>
                    <li>• Maintain security</li>
                    <li>• Comply with law</li>
                  </ul>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="consent-heading">
              <h2 id="consent-heading" className="text-2xl font-semibold text-foreground mb-4">
                Legal Bases and Consent
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We rely on user consent and legitimate interests; users may withdraw consent where applicable.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="cookies-heading">
              <div className="flex items-center mb-4">
                <Cookie className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="cookies-heading" className="text-2xl font-semibold text-foreground" data-testid="section-cookies">
                  Cookies and Tracking
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We use essential cookies and analytics. Users can control cookies via browser settings.
                    Session cookies are encrypted and secured with httpOnly and secure flags.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="sharing-heading">
              <h2 id="sharing-heading" className="text-2xl font-semibold text-foreground mb-4">
                Data Sharing
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground mb-4">
                    We may share data with:
                  </p>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Service providers (hosting, analytics, payments, email/SMS)</li>
                    <li>• Compliance with legal requests</li>
                    <li>• Mergers/acquisitions</li>
                  </ul>
                  <p className="text-muted-foreground mt-4 font-medium">
                    We do not sell personal information.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="coppa-heading">
              <div className="flex items-center mb-4">
                <Users className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="coppa-heading" className="text-2xl font-semibold text-foreground" data-testid="section-childrens-privacy">
                  FERPA/COPPA and Student Privacy
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We design for student privacy. We do not knowingly collect personal information from 
                    children under 13. Education records are handled in accordance with applicable law and 
                    only with appropriate authorization.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="retention-heading">
              <div className="flex items-center mb-4">
                <Clock className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="retention-heading" className="text-2xl font-semibold text-foreground" data-testid="section-data-retention">
                  Data Retention
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Data is kept only as long as necessary for the purposes above and to meet legal obligations.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="security-heading">
              <div className="flex items-center mb-4">
                <Lock className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="security-heading" className="text-2xl font-semibold text-foreground">
                  Security
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We implement administrative, technical, and physical safeguards including 256-bit SSL 
                    encryption, bcrypt password hashing, rate limiting, and comprehensive audit logging. 
                    However, no system is 100% secure.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="transfers-heading">
              <h2 id="transfers-heading" className="text-2xl font-semibold text-foreground mb-4">
                International Transfers
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Where data crosses borders, we use appropriate safeguards as required by law.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="rights-heading">
              <div className="flex items-center mb-4">
                <Shield className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="rights-heading" className="text-2xl font-semibold text-foreground" data-testid="section-your-rights">
                  Your Rights
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6 space-y-2">
                  <p className="text-muted-foreground">You have the right to:</p>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Access your personal data</li>
                    <li>• Request correction of inaccurate data</li>
                    <li>• Request deletion of your data</li>
                    <li>• Data portability</li>
                    <li>• Restriction or objection to processing (as applicable)</li>
                  </ul>
                  <p className="text-muted-foreground mt-4">
                    Contact us at <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline" data-testid="link-rights-email">{CONTACT_EMAIL}</a> to exercise your rights.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="communications-heading">
              <h2 id="communications-heading" className="text-2xl font-semibold text-foreground mb-4">
                Communications
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Users can opt out of non-essential emails/SMS; transactional messages may still occur.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="thirdparty-heading">
              <h2 id="thirdparty-heading" className="text-2xl font-semibold text-foreground mb-4">
                Third-Party Links
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We are not responsible for third-party sites' privacy practices.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="changes-heading">
              <h2 id="changes-heading" className="text-2xl font-semibold text-foreground mb-4">
                Changes to This Policy
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We will update this policy as needed and post the new Effective Date.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="contact-heading">
              <div className="flex items-center mb-4">
                <Mail className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="contact-heading" className="text-2xl font-semibold text-foreground" data-testid="section-contact">
                  Contact Us
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <div className="bg-muted p-4 rounded-lg space-y-2">
                    <p className="font-medium text-foreground">{COMPANY_LEGAL_NAME}</p>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="w-4 h-4 text-primary" aria-hidden="true" />
                      <span>{CONTACT_ADDRESS}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-4 h-4 text-primary" aria-hidden="true" />
                      <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline" data-testid="link-privacy-email">{CONTACT_EMAIL}</a>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4 text-primary" aria-hidden="true" />
                      <a href={`tel:${CONTACT_PHONE}`} className="text-primary hover:underline" data-testid="link-privacy-phone">{CONTACT_PHONE}</a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-8 pt-4 border-t" aria-label="Legal pages">
              <Link href="/terms" className="hover:text-primary transition-colors" data-testid="link-terms">
                Terms of Service
              </Link>
              <Link href="/accessibility" className="hover:text-primary transition-colors" data-testid="link-accessibility">
                Accessibility Statement
              </Link>
              <Link href="/" className="hover:text-primary transition-colors" data-testid="link-home">
                Back to Home
              </Link>
            </nav>
          </div>
        </main>
      </div>
    </>
  );
}
