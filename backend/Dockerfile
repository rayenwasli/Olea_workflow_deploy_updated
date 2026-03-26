FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

# create upload dirs (mounted in compose but useful for local runs)
RUN mkdir -p /app/uploads/bordereaux /app/uploads/chat

EXPOSE 8080
CMD ["npm","start"]
