FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose Vite port
EXPOSE 5173

# Start Vite with --host flag so it exposes the port to Docker mapping
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
