# Scholar Auth - Production Dockerfile
# Uses pre-built dist bundle

FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S scholar -u 1001

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy pre-built application
COPY dist ./dist

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Update CORS for Railway domains
ENV CORS_ALLOWED_ORIGINS="https://provider.scholaraiadvisor.com,https://student.scholaraiadvisor.com,https://scholaraiadvisor.com,https://www.scholaraiadvisor.com,https://auth.scholaraiadvisor.com"
ENV ALLOW_LOCALHOST=false

# Switch to non-root user
USER scholar

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: process.env.PORT || 8080, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

EXPOSE 8080

CMD ["node", "dist/index.js"]
