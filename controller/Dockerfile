# Use a lightweight Node.js base image
FROM node:22-alpine AS builder

# If $target is empty or undefined, exit non-zero and print an error
ARG BUILD_TARGET
RUN [ -n "${BUILD_TARGET}" ] \
    || (echo >&2 "Error: build-arg 'BUILD_TARGET' must be set (docker-compose.yml: <service>.args.BUILD_TARGET)"; exit 1)
ARG RUN_TARGET
RUN [ -n "${RUN_TARGET}" ] \
    || (echo >&2 "Error: build-arg 'RUN_TARGET' must be set (docker-compose.yml: <service>.args.RUN_TARGET)"; exit 1)
# Set working directory inside the container
WORKDIR /app

# Copy package files and install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the TypeScript project
RUN npm run build:prod

# Use a smaller final image
FROM node:22-alpine AS runner
WORKDIR /app

# Copy only necessary files from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Set environment variables (optional)
ENV NODE_ENV=production

ARG RUN_TARGET
ENV RUN_TARGET=${RUN_TARGET}

# Command to run the app
CMD node $RUN_TARGET