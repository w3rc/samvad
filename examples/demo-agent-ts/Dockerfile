FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3003
CMD ["node", "dist/index.js"]
