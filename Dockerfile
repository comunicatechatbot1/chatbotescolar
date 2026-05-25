# Image size ~ 400MB
FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate
ENV PNPM_HOME=/usr/local/bin

COPY package.json pnpm-lock.yaml ./

RUN apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++ \
    && apk add --no-cache git \
    && pnpm install --frozen-lockfile \
    && apk del .gyp

COPY . .

FROM node:24-alpine AS deploy

WORKDIR /app

ARG PORT
ENV PORT $PORT
EXPOSE $PORT

COPY --from=builder /app ./

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate
ENV PNPM_HOME=/usr/local/bin

RUN npm cache clean --force && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs \
    && rm -rf $PNPM_HOME/.npm $PNPM_HOME/.node-gyp

CMD ["npm", "start"]
