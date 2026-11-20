FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# 国内环境走 npmmirror 提速；如需官方源：--build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry $NPM_REGISTRY && npm install
COPY src ./src
COPY admin ./admin
COPY db ./db
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.mjs"]
