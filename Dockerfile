FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./

# Install dev dependencies too: the build needs vite. They are pruned after the build.
RUN npm ci

COPY . .

RUN npm run build && npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production

# Neon: the direct connection is the pooled one without "-pooler". Derive DIRECT_URL if it isn't set.
CMD ["sh", "-c", "export DIRECT_URL=\"${DIRECT_URL:-$(echo \"$DATABASE_URL\" | sed 's/-pooler//')}\" && npm run docker-start"]
