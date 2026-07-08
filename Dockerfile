FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
