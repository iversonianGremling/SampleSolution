FROM node:20-alpine AS builder

WORKDIR /app
ARG VITE_ENABLE_SPOTIFY_IMPORT=1
ARG VITE_SHOW_DOWNLOAD_TOOLS_UI=0
ENV VITE_ENABLE_SPOTIFY_IMPORT=$VITE_ENABLE_SPOTIFY_IMPORT
ENV VITE_SHOW_DOWNLOAD_TOOLS_UI=$VITE_SHOW_DOWNLOAD_TOOLS_UI

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
