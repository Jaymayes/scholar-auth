import { Shield, AlertTriangle, FileText, Scale, XCircle, Mail, MapPin, Phone, Globe, Users, CreditCard } from "lucide-react";
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
const JURISDICTION = "State of Arizona, USA";
const EFFECTIVE_DATE = "2025-12-01";

export default function Terms() {
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
        title={`Terms of Service | ${BRAND_NAME} – ${APP_NAME}`}
        description={`Terms of Service for ${BRAND_NAME} by ${COMPANY_LEGAL_NAME}. Read our terms governing the use of our scholarship discovery platform.`}
        canonicalPath="/terms"
        schema={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-primary text-primary-foreground px-4 py-2 rounded z-50" data-testid="link-skip-to-content">
          Skip to main content
        </a>
        
        <main id="main-content" role="main" aria-label="Terms of Service">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-foreground mb-2" data-testid="text-terms-title">
                Terms of Service
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="text-effective-date">
                Effective Date: {EFFECTIVE_DATE}
              </p>
            </div>

            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <FileText className="w-8 h-8 text-primary flex-shrink-0 mt-1" aria-hidden="true" />
                  <div>
                    <h2 className="text-xl font-semibold text-foreground mb-2">Agreement</h2>
                    <p className="text-foreground leading-relaxed">
                      These Terms govern your use of {BRAND_NAME} at{" "}
                      <a href={MAIN_SITE_URL} className="text-primary hover:underline" data-testid="link-main-site">{MAIN_SITE_URL}</a> and 
                      this app at <a href={APP_BASE_URL} className="text-primary hover:underline" data-testid="link-app-site">{APP_BASE_URL}</a>. 
                      By using the services, you agree to these Terms.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <section className="mb-8" aria-labelledby="eligibility-heading">
              <div className="flex items-center mb-4">
                <Users className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="eligibility-heading" className="text-2xl font-semibold text-foreground">
                  Eligibility and Accounts
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    You are responsible for your credentials and keeping your account secure. You must be of 
                    legal age to form a binding contract or have appropriate consent.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="services-heading">
              <div className="flex items-center mb-4">
                <Globe className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="services-heading" className="text-2xl font-semibold text-foreground">
                  Services and AI Assistance
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <p className="text-muted-foreground">
                    Our tools provide scholarship discovery, matching, content drafting, and workflow support.
                  </p>
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-700">
                    <p className="text-foreground font-medium">
                      AI outputs may contain errors; review and verify before submitting applications.
                    </p>
                  </div>
                  <p className="text-muted-foreground">
                    Do not use the services to cheat or commit academic misconduct.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="content-heading">
              <h2 id="content-heading" className="text-2xl font-semibold text-foreground mb-4">
                User Content and Licenses
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    You retain your content. You grant us a limited license to host/process your content 
                    solely to provide the services.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="providers-heading">
              <h2 id="providers-heading" className="text-2xl font-semibold text-foreground mb-4">
                Providers
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Providers submitting scholarships represent they have rights to publish the content and 
                    consent to display it. Platform fees may apply.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="payments-heading">
              <div className="flex items-center mb-4">
                <CreditCard className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="payments-heading" className="text-2xl font-semibold text-foreground">
                  Payments
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Prices, credits, and fees are shown at purchase. Taxes may apply. All sales are subject 
                    to our refund policy if provided in the app.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="prohibited-heading">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="prohibited-heading" className="text-2xl font-semibold text-foreground" data-testid="section-acceptable-use">
                  Prohibited Uses
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground mb-4">You agree NOT to:</p>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>Abuse, reverse engineer, or conduct unauthorized scraping</li>
                    <li>Perform security testing without permission</li>
                    <li>Violate law or infringe intellectual property</li>
                    <li>Harass others</li>
                  </ul>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="ip-heading">
              <h2 id="ip-heading" className="text-2xl font-semibold text-foreground mb-4">
                Intellectual Property
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    {BRAND_NAME} and its software, trademarks, and content are owned by {COMPANY_LEGAL_NAME} or licensors.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="disclaimers-heading">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-6 h-6 text-yellow-500 mr-2" aria-hidden="true" />
                <h2 id="disclaimers-heading" className="text-2xl font-semibold text-foreground">
                  Disclaimers
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground font-medium">
                    Services are provided "AS IS" and "AS AVAILABLE." We disclaim warranties to the fullest 
                    extent permitted by law.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="liability-heading">
              <div className="flex items-center mb-4">
                <Scale className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="liability-heading" className="text-2xl font-semibold text-foreground" data-testid="section-liability">
                  Limitation of Liability
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <p className="text-muted-foreground">
                    To the maximum extent permitted, we are not liable for indirect, incidental, consequential, 
                    or special damages.
                  </p>
                  <p className="text-muted-foreground">
                    Our aggregate liability is limited to the amounts you paid in the 12 months prior to the claim.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="indemnity-heading">
              <h2 id="indemnity-heading" className="text-2xl font-semibold text-foreground mb-4">
                Indemnity
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    You agree to indemnify us for claims arising from your misuse of the services or violation of these Terms.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="termination-heading">
              <div className="flex items-center mb-4">
                <XCircle className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="termination-heading" className="text-2xl font-semibold text-foreground" data-testid="section-termination">
                  Termination
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We may suspend or terminate accounts for violations or risks to the platform. You may stop 
                    using the services at any time.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="governing-heading">
              <div className="flex items-center mb-4">
                <Scale className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="governing-heading" className="text-2xl font-semibold text-foreground" data-testid="section-governing-law">
                  Governing Law and Venue
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    Arizona law governs. Venue lies in Maricopa County, Arizona. If we offer arbitration terms, 
                    they will be presented separately.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="changes-heading">
              <h2 id="changes-heading" className="text-2xl font-semibold text-foreground mb-4">
                Changes
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We may update these Terms and will post the new Effective Date.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="contact-heading">
              <div className="flex items-center mb-4">
                <Mail className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="contact-heading" className="text-2xl font-semibold text-foreground">
                  Contact
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
                      <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline" data-testid="link-legal-email">{CONTACT_EMAIL}</a>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4 text-primary" aria-hidden="true" />
                      <a href={`tel:${CONTACT_PHONE}`} className="text-primary hover:underline" data-testid="link-legal-phone">{CONTACT_PHONE}</a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-8 pt-4 border-t" aria-label="Legal pages">
              <Link href="/privacy" className="hover:text-primary transition-colors" data-testid="link-privacy">
                Privacy Policy
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
