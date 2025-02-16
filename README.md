# Stress Testing for Scalable WebSocket System

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
- Concurrent Batch Message Processing
- Efficient Connection Reuse
- Robust Retry and Reconnection Logic
- Effective Cleanup and Deregistration
- Detailed performance metrics collection
- Comprehensive Memory Usage Monitoring

## Prerequisites

- Node.js (v18)
- Redis server
- Nginx
- Docker and Docker Compose
- Git
- npm or yarn


## Quick Start

### Nginx Setup

1. Install Nginx if not already installed:
```bash
sudo apt update
sudo apt install nginx
```

2. Replace the default Nginx configuration:
```bash
sudo cp nginx.conf /etc/nginx/nginx.conf
sudo cp sites-available/default /etc/nginx/sites-available/default
```

3. Test and restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### Docker Setup

1. Clone the repository:
```bash
git clone https://github.com/darkball1/stress-testing.git
cd stress-testing
```

2. Start the server using Docker Compose:
```bash
docker compose up --build -d
```

3. Monitor the server logs:
```bash
docker logs stress-testing-main-app-1
```

### Development Setup

To run the server locally without Docker:

1. Install dependencies:
```bash
npm install
```
2. Start redis server:
```bash
redis-server
```

3. Start server:
```bash
node server.js
```
4. Start benchmarking script:
```bash
node advanced_benchmark.js
```

## Configuration

### Nginx Configuration
The system uses Nginx as a load balancer and reverse proxy for WebSocket connections. The setup includes:
- 12 WebSocket upstream servers (ports 9001-9012)
- Load balancing using IP hash method
- Connection timeout configurations

Example Nginx configuration:
nginx
# WebSocket upstream configuration
```bash
upstream websocket_servers {
    ip_hash;  # Session persistence
    server localhost:9001;
    server localhost:9002;
    server localhost:9003;
    # ... up to
    server localhost:9012;
}
```
### Server Configuration
Environment variables for server:
- REDIS_URL: Redis connection URL (default: redis://localhost:6379)
- PORT: Base port for the WebSocket server (default: 9001)
- Ports used: 9001-9012 for individual WebSocket instances

### Load Testing Configuration
Key constants in advanced_benchmark.js:
```bash// Load Testing Configuration Constants
// Load Testing Configuration Constants
const WS_SERVER_URL = 'ws://localhost/ws';              // WebSocket server URL
const BATCH_SIZE = 1000;                                 // Connections per batch
const BATCH_INTERVAL = 1000;                             // Interval between batches (ms)
const ACQUIRE_TIMEOUT = 15000;                           // Connection timeout (ms)
const MESSAGES_PER_CLIENT = 40;                          // Messages per connection
const MAX_CONCURRENT_BATCHES = 10;                       // Number of concurrent batches
const MESSAGE_SEND_INTERVAL = 20;                        // Interval between message sends (ms)
const MAX_RETRIES = 3;                                  // Maximum retries
const RETRY_DELAY = 1000;                               // Retry delay (ms)
const KEEP_ALIVE = true;                                // Keep-alive option
const KEEP_ALIVE_INTERVAL = 30000;                      // Keep-alive interval (ms)

```

## API

### WebSocket Events

#### Client to Server:
- Messages should be sent as text (binary messages are not supported)
- Each message increments a counter in Redis

#### Server to Client:
1. Session Event:
```json
{
    "type": "session",
    "sessionId": "uuid-v4",
    "timestamp": "ISO-8601-timestamp"
}
```

2. Response Event:
```json
{
    "type": "response",
    "message": "Message received successfully!",
    "messageCount": 10
}
```

3. Error Event:
```json
{
    "type": "error",
    "message": "Failed to process message",
    "error": "error-message"
}
```

4. Server Event:
```json
{
    "type": "server-event",
    "message": "This is a server-side event",
    "timestamp": "ISO-8601-timestamp"
}
```

## Architecture

### System Architecture
1. *Nginx Layer*:
   - Load balancing across 12 WebSocket instances
   - IP hash-based session persistence
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
- Batch Message Sending
- Retry Mechanism
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
- Configure proper logging
- Monitor connection counts per upstream server
- Consider rate limiting for production environments

### Server
- Configure appropriate maxPayloadLength
- Adjust idleTimeout based on requirements
- Monitor Redis memory usage
- Configure proper logging
- Set up monitoring for worker process health

### Load Testing
- Adjust batch sizes and maximum concurrent batches based on available system resources
- Monitor system memory usage during tests
- Consider network capacity when setting connection limits
- Implement proper error handling
- Use appropriate timeout values

## Error Handling

The system implements comprehensive error handling across all layers:
- Nginx connection and proxy errors
- Redis connection errors
- WebSocket message transmission errors
- Operation timeouts
- Memory overflow situations
- Connection failures
- Message sending errors

## Contributing

Feel free to submit issues and enhancement requests!
