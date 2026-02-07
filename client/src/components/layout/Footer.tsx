import { Link } from "wouter";
import { Shield, Eye, Clock, Zap, Accessibility, Brain, Mail, Phone, MapPin, ExternalLink } from "lucide-react";

const BRAND_NAME = "Scholar AI Advisor";
const COMPANY_LEGAL_NAME = "Referral Service LLC";
const MAIN_SITE_URL = "https://scholaraiadvisor.com";
const CONTACT_EMAIL = "support@referralsvc.com";
const CONTACT_PHONE = "602-796-0177";
const CONTACT_ADDRESS = "16031 N 171st Ln, Surprise, AZ 85388, USA";
const COPYRIGHT_LINE = "© 2025 Referral Service LLC. All rights reserved.";

interface FooterProps {
  variant?: "full" | "minimal";
}

export function Footer({ variant = "full" }: FooterProps) {
  return (
    <footer className="relative z-10 border-t border-border bg-card/80 backdrop-blur-sm" role="contentinfo" aria-label="Site footer">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {variant === "full" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-center mb-8">
              <div className="flex flex-col items-center" data-testid="trust-badge-performance">
                <Zap className="text-green-500 text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">60ms P95</h4>
                <p className="text-xs text-muted-foreground">Lightning-fast auth</p>
              </div>
              <div className="flex flex-col items-center" data-testid="trust-badge-security">
                <Shield className="text-blue-500 text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">96/100 Security</h4>
                <p className="text-xs text-muted-foreground">Executive-grade protection</p>
              </div>
              <div className="flex flex-col items-center" data-testid="trust-badge-accessibility">
                <Accessibility className="text-purple-500 text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">95.5% WCAG 2.2 AA</h4>
                <p className="text-xs text-muted-foreground">Inclusive design</p>
              </div>
              <div className="flex flex-col items-center" data-testid="trust-badge-responsible-ai">
                <Brain className="text-orange-500 text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">96/100 Responsible AI</h4>
                <p className="text-xs text-muted-foreground">Ethical AI practices</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-center border-t border-border pt-6 mb-6">
              <div className="flex flex-col items-center">
                <Shield className="text-primary text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">256-bit SSL</h4>
                <p className="text-xs text-muted-foreground">Bank-level encryption</p>
              </div>
              <div className="flex flex-col items-center">
                <Shield className="text-primary text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">bcrypt Hashing</h4>
                <p className="text-xs text-muted-foreground">Secure password storage</p>
              </div>
              <div className="flex flex-col items-center">
                <Eye className="text-primary text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">Audit Logging</h4>
                <p className="text-xs text-muted-foreground">Complete activity tracking</p>
              </div>
              <div className="flex flex-col items-center">
                <Clock className="text-primary text-2xl mb-2" aria-hidden="true" />
                <h4 className="font-medium text-foreground">Rate Limiting</h4>
                <p className="text-xs text-muted-foreground">Brute force protection</p>
              </div>
            </div>
          </>
        )}

        <div className="border-t border-border pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="text-center md:text-left">
              <a 
                href={MAIN_SITE_URL} 
                className="font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-brand"
              >
                {BRAND_NAME}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
              <p className="text-sm text-muted-foreground mt-1">{COMPANY_LEGAL_NAME}</p>
            </div>

            <div className="text-center md:text-left space-y-1">
              <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                <span>{CONTACT_ADDRESS}</span>
              </div>
              <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-muted-foreground">
                <Mail className="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                <a 
                  href={`mailto:${CONTACT_EMAIL}`} 
                  className="hover:text-primary transition-colors"
                  data-testid="link-contact-email"
                >
                  {CONTACT_EMAIL}
                </a>
              </div>
              <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-muted-foreground">
                <Phone className="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                <a 
                  href={`tel:${CONTACT_PHONE}`} 
                  className="hover:text-primary transition-colors"
                  data-testid="link-contact-phone"
                >
                  {CONTACT_PHONE}
                </a>
              </div>
            </div>

            <nav className="text-center md:text-right" aria-label="Legal links">
              <h4 className="font-medium text-foreground mb-2">Legal</h4>
              <div className="flex flex-col space-y-1">
                <Link 
                  href="/privacy" 
                  className="text-sm text-muted-foreground hover:text-primary transition-colors" 
                  data-testid="link-privacy-policy"
                >
                  Privacy Policy
                </Link>
                <Link 
                  href="/terms" 
                  className="text-sm text-muted-foreground hover:text-primary transition-colors" 
                  data-testid="link-terms-of-service"
                >
                  Terms of Service
                </Link>
                <Link 
                  href="/accessibility" 
                  className="text-sm text-muted-foreground hover:text-primary transition-colors" 
                  data-testid="link-accessibility"
                >
                  Accessibility Statement
                </Link>
                <Link 
                  href="/trust-security" 
                  className="text-sm text-muted-foreground hover:text-primary transition-colors" 
                  data-testid="link-trust-security"
                >
                  Trust & Security
                </Link>
              </div>
            </nav>
          </div>

          <div className="border-t border-border pt-4 text-center">
            <p className="text-sm text-muted-foreground" data-testid="text-copyright">
              {COPYRIGHT_LINE}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function ReportFooter() {
  const APP_NAME = "scholar_auth";
  const APP_BASE_URL = "https://scholar-auth-jamarrlmayes.replit.app";
  
  return (
    <div 
      className="text-[10px] text-muted-foreground mt-4 pt-2 border-t border-border text-center"
      style={{ fontSize: '10px' }}
      data-testid="report-footer"
    >
      This report was generated by {APP_NAME} — {APP_BASE_URL} | {BRAND_NAME} by {COMPANY_LEGAL_NAME} | {CONTACT_EMAIL} | {CONTACT_PHONE}
    </div>
  );
}
