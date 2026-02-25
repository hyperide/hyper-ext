# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN npm install

# Copy source
COPY . .

# Build static site
RUN npm run build

# Production stage - nginx unprivileged for static files
FROM nginxinc/nginx-unprivileged:alpine

# Copy built static files (nginx-unprivileged uses /usr/share/nginx/html)
COPY --from=builder /app/out /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Health check (nginx-unprivileged runs on port 8080 by default)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

EXPOSE 8080

# nginx-unprivileged image already has non-root user 'nginx' (uid 101)
USER nginx

CMD ["nginx", "-g", "daemon off;"]
