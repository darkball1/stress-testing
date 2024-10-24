# Use the official Node.js image as a base
FROM node:18

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy only the necessary application files
COPY server.js ./
COPY advanced_benchmark.js ./

# Install Nginx
RUN apt-get update && apt-get install -y nginx

# Copy Nginx configuration files
COPY nginx.conf /etc/nginx/nginx.conf
COPY sites-available/default /etc/nginx/sites-available/default

# Enable the default site
#RUN ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/

# Create wait-for-redis script
RUN echo '#!/bin/bash\n\
until nc -z ${REDIS_HOST:-redis} ${REDIS_PORT:-6379}; do\n\
  echo "Waiting for Redis to be available...";\n\
  sleep 1;\n\
done\n\
echo "Redis is available, starting application..."' > /wait-for-redis.sh && \
chmod +x /wait-for-redis.sh


# Expose the ports the app runs on
EXPOSE 80 9001-9012

# Start Nginx and the Node.js applications
CMD service nginx start && node server.js & node advanced_benchmark.js
