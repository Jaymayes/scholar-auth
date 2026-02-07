import { useEffect } from 'react';
import { useLocation } from 'wouter';

interface SEOProps {
  title?: string;
  description?: string;
  canonicalPath?: string;
  noindex?: boolean;
  schema?: Record<string, any>;
}

export function SEO({
  title,
  description,
  canonicalPath,
  noindex = false,
  schema
}: SEOProps) {
  const [location] = useLocation();
  
  useEffect(() => {
    const currentUrl = window.location.origin + (canonicalPath || location);
    
    if (title) {
      document.title = title;
    }
    
    let metaDescription = document.querySelector('meta[name="description"]');
    if (description) {
      if (!metaDescription) {
        metaDescription = document.createElement('meta');
        metaDescription.setAttribute('name', 'description');
        document.head.appendChild(metaDescription);
      }
      metaDescription.setAttribute('content', description);
    }
    
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = currentUrl;
    
    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.setAttribute('name', 'robots');
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.setAttribute('content', noindex ? 'noindex, nofollow' : 'index, follow');
    
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (title) {
      if (!ogTitle) {
        ogTitle = document.createElement('meta');
        ogTitle.setAttribute('property', 'og:title');
        document.head.appendChild(ogTitle);
      }
      ogTitle.setAttribute('content', title);
    }
    
    let ogDesc = document.querySelector('meta[property="og:description"]');
    if (description) {
      if (!ogDesc) {
        ogDesc = document.createElement('meta');
        ogDesc.setAttribute('property', 'og:description');
        document.head.appendChild(ogDesc);
      }
      ogDesc.setAttribute('content', description);
    }
    
    let ogUrl = document.querySelector('meta[property="og:url"]');
    if (!ogUrl) {
      ogUrl = document.createElement('meta');
      ogUrl.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrl);
    }
    ogUrl.setAttribute('content', currentUrl);
    
    if (schema) {
      let schemaScript = document.querySelector('script[type="application/ld+json"][data-page-schema]') as HTMLScriptElement;
      if (!schemaScript) {
        schemaScript = document.createElement('script');
        schemaScript.type = 'application/ld+json';
        schemaScript.setAttribute('data-page-schema', 'true');
        document.head.appendChild(schemaScript);
      }
      schemaScript.textContent = JSON.stringify(schema);
    }
    
    return () => {
      const schemaScript = document.querySelector('script[data-page-schema]');
      if (schemaScript) {
        schemaScript.remove();
      }
    };
  }, [title, description, canonicalPath, location, noindex, schema]);
  
  return null;
}

export function getOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "ScholarshipAI",
    "url": window.location.origin,
    "logo": window.location.origin + "/logo.png",
    "description": "Enterprise-grade authentication platform for students and educational institutions with WCAG 2.2 AA accessibility and 60ms P95 performance.",
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "Customer Support",
      "email": "support@scholarshipai.com"
    },
    "sameAs": []
  };
}

export function getWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "ScholarshipAI",
    "url": window.location.origin,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": window.location.origin + "/search?q={search_term_string}"
      },
      "query-input": "required name=search_term_string"
    }
  };
}

export function getBreadcrumbSchema(items: Array<{ name: string; url?: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": item.url ? window.location.origin + item.url : undefined
    }))
  };
}
