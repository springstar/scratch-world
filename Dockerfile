# Stage 1: Build backend
FROM node:22-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Build viewer
FROM node:22-alpine AS viewer-builder
WORKDIR /viewer
COPY viewer/package*.json ./
RUN npm ci
COPY viewer ./
RUN npm run build

# Stage 3: Runtime
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/src/skills ./src/skills
COPY --from=viewer-builder /viewer/dist ./viewer/dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
