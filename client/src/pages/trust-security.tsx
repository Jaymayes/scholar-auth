import { SEO, getOrganizationSchema, getBreadcrumbSchema } from "@/components/SEO";
import { Shield, Lock, Eye, FileText, Users, AlertCircle } from "lucide-react";

export default function TrustSecurity() {
  const lastUpdated = "October 26, 2025";
  
  const breadcrumbSchema = getBreadcrumbSchema([
    { name: "Home", url: "/" },
    { name: "Trust & Security" }
  ]);
  
  const combinedSchema = {
    "@context": "https://schema.org",
    "@graph": [
      getOrganizationSchema(),
      breadcrumbSchema
    ]
  };
  
  return (
    <>
      <SEO 
        title="Trust & Security - ScholarshipAI"
        description="Learn about ScholarshipAI's commitment to security, privacy, and responsible AI. FERPA/COPPA compliant with 99.9% uptime and enterprise-grade encryption."
        canonicalPath="/trust-security"
        schema={combinedSchema}
      />
      
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4" data-testid="heading-trust-security">
              Trust & Security
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Your security and privacy are our top priorities. We're committed to transparency, responsible AI, and protecting student data.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Last updated: {lastUpdated}
            </p>
          </div>

          <nav className="mb-8 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold mb-2 text-gray-900 dark:text-white">Table of Contents</h2>
            <ul className="space-y-1 text-sm">
              <li><a href="#mission" className="text-blue-600 hover:underline dark:text-blue-400">Our Mission & Responsible AI</a></li>
              <li><a href="#data" className="text-blue-600 hover:underline dark:text-blue-400">Data Collection & Privacy</a></li>
              <li><a href="#security" className="text-blue-600 hover:underline dark:text-blue-400">Security Measures</a></li>
              <li><a href="#compliance" className="text-blue-600 hover:underline dark:text-blue-400">Compliance & Regulations</a></li>
              <li><a href="#ai-transparency" className="text-blue-600 hover:underline dark:text-blue-400">AI Transparency</a></li>
              <li><a href="#fees" className="text-blue-600 hover:underline dark:text-blue-400">Fees & Business Model</a></li>
              <li><a href="#accessibility" className="text-blue-600 hover:underline dark:text-blue-400">Accessibility</a></li>
            </ul>
          </nav>

          <div className="space-y-8">
            <section id="mission" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Our Mission & Responsible AI</h2>
                  <p className="text-gray-700 dark:text-gray-300 mb-3">
                    ScholarshipAI exists to democratize access to educational funding. We believe every student deserves a fair chance at financial aid, regardless of background.
                  </p>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Our Commitments:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                    <li><strong>Student-First:</strong> Your educational success drives our decisions</li>
                    <li><strong>No Academic Dishonesty:</strong> We never enable plagiarism or essay writing that violates academic integrity</li>
                    <li><strong>Bias Mitigation:</strong> Regular audits to detect and eliminate algorithmic bias</li>
                    <li><strong>Transparency:</strong> Clear disclosure when AI is used in your experience</li>
                    <li><strong>Human Oversight:</strong> Critical decisions involve human review</li>
                  </ul>
                </div>
              </div>
            </section>

            <section id="data" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <Eye className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Data Collection & Privacy</h2>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 mt-4">What We Collect:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Account information (name, email, date of birth for age verification)</li>
                    <li>Educational profile (grade level, academic interests, eligibility criteria)</li>
                    <li>Usage data (pages viewed, searches, scholarship matches)</li>
                    <li>Device and browser information for security and performance</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Why We Collect It:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Match you with relevant scholarships</li>
                    <li>Improve our recommendation algorithms</li>
                    <li>Comply with legal requirements (COPPA, FERPA)</li>
                    <li>Prevent fraud and ensure platform security</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Data Retention & Deletion:</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-2">
                    Active accounts: Data retained while account is active
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 mb-2">
                    Inactive accounts: Automatically deleted after 36 months of inactivity
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    <strong>Request deletion anytime:</strong> Email <a href="mailto:privacy@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">privacy@scholarshipai.com</a>. We delete within 30 days.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Parental Consent for Minors:</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Users under 13 require verifiable parental consent. Parents can review, modify, or delete their child's data anytime by contacting <a href="mailto:privacy@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">privacy@scholarshipai.com</a>.
                  </p>
                </div>
              </div>
            </section>

            <section id="security" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <Lock className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Security Measures</h2>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 mt-4">Encryption:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li><strong>In Transit:</strong> TLS 1.3 encryption for all data transfers</li>
                    <li><strong>At Rest:</strong> AES-256 encryption for stored data</li>
                    <li><strong>Secrets Management:</strong> Secure key rotation and hardware security modules</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Access Controls:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Role-based access control (RBAC) with principle of least privilege</li>
                    <li>Multi-factor authentication for all staff accounts</li>
                    <li>Regular access reviews and immediate revocation on termination</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Monitoring & Incident Response:</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-2">
                    <strong>Uptime Target:</strong> 99.9% availability
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 mb-2">
                    <strong>Status Page:</strong> <a href="https://status.scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">status.scholarshipai.com</a>
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    24/7 security monitoring with automated threat detection. Incident response team responds within 4 hours for critical issues.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Vulnerability Reporting:</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Found a security issue? Please report it responsibly to <a href="mailto:security@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">security@scholarshipai.com</a>. We appreciate responsible disclosure and will acknowledge reports within 48 hours.
                  </p>
                </div>
              </div>
            </section>

            <section id="compliance" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Compliance & Regulations</h2>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 mt-4">FERPA (Family Educational Rights and Privacy Act):</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    We handle education records in compliance with FERPA. Student education records are never shared with third parties without explicit consent.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">COPPA (Children's Online Privacy Protection Act):</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    Users under 13 require verifiable parental consent. We implement age verification and restrict data collection for minors per COPPA requirements.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">GDPR & CCPA Rights:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li><strong>Access:</strong> Request a copy of your data</li>
                    <li><strong>Correction:</strong> Update inaccurate information</li>
                    <li><strong>Deletion:</strong> Request complete data removal</li>
                    <li><strong>Portability:</strong> Export your data in machine-readable format</li>
                    <li><strong>Opt-Out:</strong> Refuse data sharing with third parties</li>
                  </ul>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    Exercise your rights: <a href="mailto:privacy@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">privacy@scholarshipai.com</a>
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Data Processing Agreement (DPA):</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Enterprise customers can request a DPA by contacting <a href="mailto:legal@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">legal@scholarshipai.com</a>.
                  </p>
                </div>
              </div>
            </section>

            <section id="ai-transparency" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">AI Transparency</h2>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 mt-4">How We Use AI:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Scholarship matching and recommendation algorithms</li>
                    <li>Content summarization (eligibility requirements, deadlines)</li>
                    <li>Fraud detection and security monitoring</li>
                    <li>Customer support chatbot (clearly labeled as AI)</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">AI Providers:</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    We use OpenAI GPT-4 for content analysis and recommendations. Your data is processed according to our agreement with OpenAI, which prohibits training on your data.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Human-in-the-Loop:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Scholarship approvals reviewed by human moderators</li>
                    <li>Appeals process for AI decisions</li>
                    <li>Regular bias audits by independent third parties</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Academic Integrity:</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    <strong>We will NEVER:</strong> Write application essays, generate fake recommendations, or enable academic dishonesty. AI assistance is limited to matching, summarizing public information, and administrative tasks.
                  </p>
                </div>
              </div>
            </section>

            <section id="fees" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Fees & Business Model</h2>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 mt-4">Student Access:</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    <strong>Always Free:</strong> Core scholarship search and matching is 100% free for students. No hidden fees.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Optional Premium Features:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Application tracking dashboard: $5/month</li>
                    <li>Priority email alerts: $3/month</li>
                    <li>Document organization tools: $4/month</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">How We Make Money:</h3>
                  <p className="text-gray-700 dark:text-gray-300 mb-2">
                    <strong>Provider Platform Fee:</strong> 3% commission from scholarship providers when students successfully apply
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    <strong>AI Service Markup:</strong> 4x markup on AI compute costs funds infrastructure, safety, and student support
                  </p>
                  
                  <p className="text-gray-700 dark:text-gray-300">
                    Transparency matters. We never sell student data or accept payment to boost scholarship rankings.
                  </p>
                </div>
              </div>
            </section>

            <section id="accessibility" className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-3 mb-4">
                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Accessibility Commitment</h2>
                  
                  <p className="text-gray-700 dark:text-gray-300 mb-4">
                    We're committed to WCAG 2.2 Level AA compliance to ensure all students can access our platform, regardless of disability.
                  </p>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Our Standards:</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 mb-4">
                    <li>Screen reader compatibility (tested with NVDA, JAWS, VoiceOver)</li>
                    <li>Keyboard navigation for all interactive elements</li>
                    <li>Sufficient color contrast ratios (4.5:1 minimum)</li>
                    <li>Clear focus indicators and skip navigation links</li>
                    <li>Alt text for all images and ARIA labels where needed</li>
                  </ul>
                  
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Support:</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Accessibility issues? Contact <a href="mailto:accessibility@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">accessibility@scholarshipai.com</a>
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 mt-2">
                    <strong>Response Time:</strong> Critical accessibility issues addressed within 24 hours
                  </p>
                </div>
              </div>
            </section>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mt-8">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Questions or Concerns?</h3>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                We're here to help. Reach out to our team:
              </p>
              <ul className="space-y-2 text-gray-700 dark:text-gray-300">
                <li><strong>General Support:</strong> <a href="mailto:support@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">support@scholarshipai.com</a></li>
                <li><strong>Privacy/Data:</strong> <a href="mailto:privacy@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">privacy@scholarshipai.com</a></li>
                <li><strong>Security:</strong> <a href="mailto:security@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">security@scholarshipai.com</a></li>
                <li><strong>Legal:</strong> <a href="mailto:legal@scholarshipai.com" className="text-blue-600 hover:underline dark:text-blue-400">legal@scholarshipai.com</a></li>
              </ul>
            </div>

            <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
              <p>
                Related: <a href="/privacy" className="text-blue-600 hover:underline dark:text-blue-400">Privacy Policy</a> | <a href="/terms" className="text-blue-600 hover:underline dark:text-blue-400">Terms of Service</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
