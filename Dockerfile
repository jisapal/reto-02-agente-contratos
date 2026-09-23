FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
RUN chown -R node:node /app
USER node
CMD ["npx", "tsx", "src/server.ts"]
