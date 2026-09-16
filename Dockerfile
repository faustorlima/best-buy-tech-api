# Estágio 1: Instala todas as dependências (incluindo devDependencies) e faz o Build
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Estágio 2: Ambiente final de produção limpo
FROM node:20-alpine AS production
WORKDIR /usr/src/app
COPY package*.json ./
# Instala apenas as dependências de produção
RUN npm ci --only=production

# Copia apenas a pasta compilada do estágio anterior
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 5000
CMD ["npm", "start"]