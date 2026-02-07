import { Accessibility, Mail, Phone, MapPin, CheckCircle, AlertTriangle } from "lucide-react";
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

export default function AccessibilityStatement() {
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
        title={`Accessibility Statement | ${BRAND_NAME} – ${APP_NAME}`}
        description={`${COMPANY_LEGAL_NAME} is committed to digital accessibility for all users. Our goal is WCAG 2.1 AA conformance across our platforms.`}
        canonicalPath="/accessibility"
        schema={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-primary text-primary-foreground px-4 py-2 rounded z-50" data-testid="link-skip-to-content">
          Skip to main content
        </a>
        
        <main id="main-content" role="main" aria-label="Accessibility Statement">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-foreground mb-2" data-testid="text-accessibility-title">
                Accessibility Statement
              </h1>
              <p className="text-sm text-muted-foreground" data-testid="text-effective-date">
                Effective Date: {EFFECTIVE_DATE}
              </p>
            </div>

            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <Accessibility className="w-8 h-8 text-primary flex-shrink-0 mt-1" aria-hidden="true" />
                  <div>
                    <h2 className="text-xl font-semibold text-foreground mb-2">Our Commitment</h2>
                    <p className="text-foreground leading-relaxed">
                      {COMPANY_LEGAL_NAME} is committed to digital accessibility for all users. Our goal is 
                      WCAG 2.1 AA conformance across <a href={MAIN_SITE_URL} className="text-primary hover:underline" data-testid="link-main-site">{MAIN_SITE_URL}</a> and 
                      this app at <a href={APP_BASE_URL} className="text-primary hover:underline" data-testid="link-app-site">{APP_BASE_URL}</a>.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <section className="mb-8" aria-labelledby="measures-heading">
              <div className="flex items-center mb-4">
                <CheckCircle className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="measures-heading" className="text-2xl font-semibold text-foreground" data-testid="section-measures">
                  Measures We Take
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <ul className="space-y-3 text-muted-foreground" role="list">
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Semantic HTML:</strong> Proper heading structure, landmarks, and ARIA labels for assistive technologies</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Keyboard Navigation:</strong> All interactive elements are fully keyboard accessible with visible focus indicators</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Color Contrast:</strong> Sufficient color contrast ratios meeting WCAG 2.1 AA standards (4.5:1 for normal text, 3:1 for large text)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Descriptive Links:</strong> All links have meaningful text and images have appropriate alt text</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Focus Management:</strong> Proper focus order and focus trapping in modals and dialogs</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Captions & Transcripts:</strong> Media content includes captions and transcripts where applicable</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-primary mt-1" aria-hidden="true">•</span>
                      <span><strong className="text-foreground">Regular Audits:</strong> We conduct accessibility audits using automated tools and manual testing</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="limitations-heading">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-6 h-6 text-yellow-500 mr-2" aria-hidden="true" />
                <h2 id="limitations-heading" className="text-2xl font-semibold text-foreground" data-testid="section-limitations">
                  Known Limitations
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    If any part of the service is not fully accessible, we will work to remediate promptly. 
                    We are continuously working to improve the accessibility of our platform and welcome your 
                    feedback on any barriers you may encounter.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="feedback-heading">
              <div className="flex items-center mb-4">
                <Mail className="w-6 h-6 text-primary mr-2" aria-hidden="true" />
                <h2 id="feedback-heading" className="text-2xl font-semibold text-foreground" data-testid="section-feedback">
                  Feedback and Requests
                </h2>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground mb-4">
                    If you encounter accessibility barriers or need an accommodation, please contact us. 
                    Include the page URL and a description of the issue so we can assist you effectively.
                  </p>
                  <div className="bg-muted p-4 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-primary" aria-hidden="true" />
                      <span className="text-foreground">Email: </span>
                      <a 
                        href={`mailto:${CONTACT_EMAIL}`} 
                        className="text-primary hover:underline"
                        data-testid="link-contact-email"
                      >
                        {CONTACT_EMAIL}
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-primary" aria-hidden="true" />
                      <span className="text-foreground">Phone: </span>
                      <a 
                        href={`tel:${CONTACT_PHONE}`} 
                        className="text-primary hover:underline"
                        data-testid="link-contact-phone"
                      >
                        {CONTACT_PHONE}
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="assessment-heading">
              <h2 id="assessment-heading" className="text-2xl font-semibold text-foreground mb-4" data-testid="section-assessment">
                Assessment
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We use automated and manual testing and train staff on accessibility best practices. 
                    Our testing includes screen reader compatibility (NVDA, VoiceOver), keyboard-only navigation, 
                    and color contrast analysis.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="improvement-heading">
              <h2 id="improvement-heading" className="text-2xl font-semibold text-foreground mb-4" data-testid="section-improvement">
                Continuous Improvement
              </h2>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">
                    We review this statement regularly and update the Effective Date when changes occur. 
                    Our commitment to accessibility is ongoing, and we continuously strive to improve 
                    the user experience for all visitors.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="mb-8" aria-labelledby="contact-heading">
              <h2 id="contact-heading" className="text-2xl font-semibold text-foreground mb-4" data-testid="section-contact">
                Contact Information
              </h2>
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
                      <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline" data-testid="link-contact-email-section">{CONTACT_EMAIL}</a>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-4 h-4 text-primary" aria-hidden="true" />
                      <a href={`tel:${CONTACT_PHONE}`} className="text-primary hover:underline" data-testid="link-contact-phone-section">{CONTACT_PHONE}</a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-8 pt-4 border-t" aria-label="Legal pages">
              <Link href="/privacy" className="hover:text-primary transition-colors" data-testid="link-privacy">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-primary transition-colors" data-testid="link-terms">
                Terms of Service
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
