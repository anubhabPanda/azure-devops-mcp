# Multi-stage build for Azure DevOps MCP HTTP Server
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy source code first (needed for build)
COPY src/ ./src/
COPY scripts/ ./scripts/

# Install ALL dependencies (including dev dependencies for building)
RUN npm ci

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Create app user
RUN groupadd -r app && useradd -r -g app app

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Change ownership to app user
RUN chown -R app:app /app
USER app

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:${PORT:-3000}/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the HTTP server
CMD ["node", "dist/index.js", "http"]