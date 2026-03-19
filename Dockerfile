FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV SQLITE_PATH=/data/app.db
COPY --from=builder /app ./
RUN mkdir -p /data
EXPOSE 8080
CMD ["npm", "start", "--", "-p", "8080"]
