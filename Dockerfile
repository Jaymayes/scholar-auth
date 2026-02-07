# Scholar Auth - Production Dockerfile
# Multi-stage build for Railway deployment

# =============================================================================
# Build Stage
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ git curl && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the application (vite + esbuild)
RUN npm run build

# =============================================================================
# Production Stage
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S scholar -u 1001

# Install curl for health check
RUN apk add --no-cache curl && rm -rf /var/cache/apk/*

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=scholar:nodejs /app/dist ./dist

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# CORS Configuration for Railway domains
ENV CORS_ALLOWED_ORIGINS="https://provider.scholaraiadvisor.com,https://student.scholaraiadvisor.com,https://scholaraiadvisor.com,https://www.scholaraiadvisor.com,https://auth.scholaraiadvisor.com"
ENV ALLOW_LOCALHOST=false

# Switch to non-root user
USER scholar

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["node", "dist/index.js"]
