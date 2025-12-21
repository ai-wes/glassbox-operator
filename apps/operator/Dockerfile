# ---- builder ----

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm install
RUN npm run build

# ---- runtime ----

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 8090
CMD ["node", "dist/index.js"]
