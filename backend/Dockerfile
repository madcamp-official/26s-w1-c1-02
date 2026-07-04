FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY db ./db
COPY data ./data
COPY scripts ./scripts

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
