# Scholar Auth - Production Dockerfile
# Uses pre-built dist bundle (no build step needed)

FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S scholar -u 1001

# Install curl for health check
RUN apk add --no-cache curl && rm -rf /var/cache/apk/*

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Patch openid-client exports to include ./passport subpath
# openid-client@5.7.1 has lib/passport_strategy.js but no exports entry for it
# Node 20 strict ESM resolution requires explicit exports map entries
COPY patches/patch-oidc-exports.js /tmp/patch-oidc-exports.js
RUN node /tmp/patch-oidc-exports.js && rm /tmp/patch-oidc-exports.js

# Copy pre-built application
COPY dist ./dist

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# CORS Configuration for Railway domains
ENV CORS_ALLOWED_ORIGINS="https://provider.scholaraiadvisor.com,https://student.scholaraiadvisor.com,https://scholaraiadvisor.com,https://www.scholaraiadvisor.com,https://auth.scholaraiadvisor.com"

# Switch to non-root user
USER scholar

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["node", "dist/index.js"]
