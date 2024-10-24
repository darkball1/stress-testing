# Scalable WebSocket System

A comprehensive WebSocket system featuring a high-performance, scalable server implementation with Nginx load balancing and a sophisticated load testing toolkit. The system uses uWebSockets.js with Redis for the server component, Nginx for load balancing and proxying, and includes advanced load testing capabilities.

## Features

### Server Features
- Multi-core processing using Node.js cluster module
- Redis-based pub/sub system for real-time event broadcasting
- Nginx load balancing across multiple WebSocket instances
- Efficient batch processing for session cleanup
- Automatic worker respawning on failure
- WebSocket compression support
- Connection tracking and management
- Configurable batch processing parameters
- Comprehensive error handling and logging
- Support for backpressure monitoring

### Load Testing Features
- Batch-based connection management
- Configurable connection parameters
- Memory usage monitoring and throttling
- Detailed performance metrics collection
- Automatic generation of performance charts
- Connection timeout handling
- Session-based statistics tracking
- Real-time metrics reporting

## Prerequisites

- Node.js (v14 or higher)
- Redis server
- Nginx
- Docker and Docker Compose
- Git
- npm or yarn

## Project Structure


.
├── server/
│   ├── server.js              # Main WebSocket server implementation
│   ├── Dockerfile            # Server Docker configuration
│   └── docker-compose.yml    # Docker Compose configuration
├── nginx/
│   ├── nginx.conf            # Main Nginx configuration
│   └── sites-available/
│       └── default           # Default site configuration
├── loadtest/
│   ├── loadtest.js           # Load testing implementation
│   └── package.json          # Load testing dependencies
└── README.md                 # This file


## Quick Start

### Nginx Setup

1. Install Nginx if not already installed:
bash
sudo apt update
sudo apt install nginx


2. Replace the default Nginx configuration:
bash
sudo cp nginx/nginx.conf /etc/nginx/nginx.conf
sudo cp nginx/sites-available/default /etc/nginx/sites-available/default


3. Test and restart Nginx:
bash
sudo nginx -t
sudo systemctl restart nginx


### Server Setup

1. Clone the repository:
bash
git clone https://github.com/yourusername/websocket-system.git
cd websocket-system


2. Start the server using Docker Compose:
bash
cd server
docker compose up --build -d


3. Monitor the server logs:
bash
docker logs stress-testing-main-app-1


### Load Testing Setup

1. Install load testing dependencies:
bash
cd loadtest
npm install


2. Run the load test:
bash
node loadtest.js


## Configuration

### Nginx Configuration
The system uses Nginx as a load balancer and reverse proxy for WebSocket connections. The setup includes:
- 12 WebSocket upstream servers (ports 9001-9012)
- Load balancing using IP hash method
- WebSocket protocol upgrade handling
- Connection timeout configurations
- SSL/TLS settings (if configured)

Example Nginx configuration:
nginx
# WebSocket upstream configuration
upstream websocket {
    ip_hash;  # Session persistence
    server localhost:9001;
    server localhost:9002;
    server localhost:9003;
    # ... up to
    server localhost:9012;
}

# Server configuration
server {
    listen 80;
    server_name your_domain.com;

    location /ws {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}


### Server Configuration
Environment variables for server:
- REDIS_URL: Redis connection URL (default: redis://localhost:6379)
- PORT: Base port for the WebSocket server (default: 9001)
- Ports used: 9001-9012 for individual WebSocket instances

### Load Testing Configuration
Key constants in loadtest.js:
javascript
const BATCH_SIZE = 1000;           // Connections per batch
const BATCH_INTERVAL = 1000;       // ms between batches
const MAX_ACTIVE_BATCHES = 50;     // Number of concurrent batches
const CONNECTION_TIMEOUT = 10000;   // 10 seconds
const MEMORY_CHECK_INTERVAL = 2000; // 2 seconds
const MAX_MEMORY_USAGE = 0.85;     // 85% of available memory
const WS_SERVER_URL = 'ws://localhost/ws';  // Nginx endpoint
const MESSAGES_PER_CLIENT = 30;    // Messages per connection


## API

### WebSocket Events

#### Client to Server:
- Messages should be sent as text (binary messages are not supported)
- Each message increments a counter in Redis

#### Server to Client:
1. Session Event:
json
{
    "type": "session",
    "sessionId": "uuid-v4",
    "timestamp": "ISO-8601-timestamp"
}


2. Response Event:
json
{
    "type": "response",
    "message": "Message received successfully!",
    "messageCount": number
}


3. Error Event:
json
{
    "type": "error",
    "message": "Failed to process message",
    "error": "error-message"
}


4. Server Event:
json
{
    "type": "server-event",
    "message": "This is a server-side event",
    "timestamp": "ISO-8601-timestamp"
}


## Architecture

### System Architecture
1. *Nginx Layer*:
   - Load balancing across 12 WebSocket instances
   - IP hash-based session persistence
   - Protocol upgrade handling
   - Connection timeout management

2. *Server Layer*:
   - Multiple WebSocket instances (ports 9001-9012)
   - Master process for worker management
   - Worker processes for connection handling

3. *Redis Layer*:
   - Pub/Sub for real-time event broadcasting
   - Session storage and message counting
   - Batch processing for cleanup operations

### Load Testing Architecture
- Batch-based connection management
- Memory-aware throttling
- Real-time metrics collection
- Comprehensive error handling
- Chart generation system

## Performance Testing Output

The load testing tool generates several output files:
- results.txt: Detailed test results and statistics
- memory-usage-chart.png: Memory usage over time
- avg-latency-chart.png: Average latency trends
- median-latency-chart.png: Median latency trends
- min-latency-chart.png: Minimum latency trends
- max-latency-chart.png: Maximum latency trends

### Metrics Tracked
- Total number of sessions
- Connection success/failure rates
- Message throughput
- Average latency
- Memory usage statistics
- Server events received
- Total messages sent/received

## Production Considerations

### Nginx
- Configure appropriate buffer sizes
- Adjust worker connections based on expected load
- Set up SSL/TLS for secure WebSocket connections
- Configure proper logging
- Monitor connection counts per upstream server
- Consider rate limiting for production environments

### Server
- Configure appropriate maxPayloadLength
- Adjust idleTimeout based on requirements
- Monitor Redis memory usage
- Configure proper logging
- Set up monitoring for worker process health
- Implement appropriate security measures

### Load Testing
- Adjust batch sizes based on available system resources
- Monitor system memory usage during tests
- Consider network capacity when setting connection limits
- Implement proper error handling
- Use appropriate timeout values

## Error Handling

The system implements comprehensive error handling across all layers:
- Nginx connection and proxy errors
- Redis connection errors
- WebSocket message transmission errors
- Process crash recovery
- Operation timeouts
- Memory overflow situations
- Connection failures
- Message sending errors
- Premature connection closures

## Contributing

Feel free to submit issues and enhancement requests!

## License

[Your chosen license]

## Acknowledgments

- Built with Node.js, uWebSockets.js, and the ws library
- Nginx for load balancing and proxying
- Charts generated using Chart.js
- Redis for pub/sub and session management
