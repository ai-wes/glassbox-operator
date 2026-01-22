# ---- builder ----

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN apk add --no-cache python3 make g++
RUN npm install
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime ----

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "dist/index.js"]
