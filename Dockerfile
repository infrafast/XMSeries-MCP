FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "const port=process.env.HTTP_PORT||8787; const headers=process.env.MCP_AUTH_TOKEN ? {Authorization: 'Bearer '+process.env.MCP_AUTH_TOKEN} : {}; fetch('http://127.0.0.1:'+port+'/health',{headers}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"

CMD ["node", "dist/http.js"]
