# Estágio de Build / Instalação
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production

# Estágio de Produção Final
FROM node:20-alpine AS production
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

# Porta padrão que sua API vai expor dentro do container
EXPOSE 5000

CMD ["npm", "start"]