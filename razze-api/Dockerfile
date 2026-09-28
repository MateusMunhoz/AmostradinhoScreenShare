FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    RAZZE_API_HOST=0.0.0.0 \
    RAZZE_API_PORT=8787 \
    RAZZE_STUN_HOST=0.0.0.0 \
    RAZZE_STUN_PORT=3478 \
    RAZZE_DB_PATH=/data/razze.sqlite

WORKDIR /app
COPY package.json server.js ./
RUN mkdir -p /data \
    && chown -R node:node /app /data

USER node
EXPOSE 8787/tcp 3478/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
