const uWS = require('uWebSockets.js');
const uuid = require('uuid');
const Redis = require('ioredis');
const cluster = require('cluster');
const os = require('os');

const port = cluster.isMaster ? 9001 : 9001 + cluster.worker.id;
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis clients for pub/sub and data storage
const redisSub = new Redis(redisUrl);
const redisPub = new Redis(redisUrl);
const redisStore = new Redis(redisUrl);

let connectionCount = 0;


class BatchProcessor {
    constructor(batchSize = 100, intervalMs = 1000) {
        this.queue = new Set();
        this.batchSize = batchSize;
        this.intervalMs = intervalMs;
        this.isProcessing = false;
        this.processingPromise = null;
    }

    add(sessionId) {
        this.queue.add(sessionId);
        this.scheduleProcessing();
    }

    async scheduleProcessing() {
        if (this.isProcessing) return;
        
        if (!this.processingPromise) {
            this.processingPromise = new Promise(resolve => {
                setTimeout(() => {
                    this.processQueue().finally(resolve);
                }, this.intervalMs);
            });
        }
        
        return this.processingPromise;
    }

    async processQueue() {
        if (this.isProcessing || this.queue.size === 0) return;
        
        try {
            this.isProcessing = true;
            const batch = Array.from(this.queue).slice(0, this.batchSize);
            
            if (batch.length > 0) {
                const pipeline = redisStore.pipeline();
                for (const sessionId of batch) {
                    pipeline.del(`session:${sessionId}`);
                    this.queue.delete(sessionId);
                }
                
                await Promise.race([
                    pipeline.exec(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Redis batch cleanup timed out')), 5000)
                    )
                ]);
            }
        } catch (error) {
            console.error('Error processing Redis cleanup batch:', error);
        } finally {
            this.isProcessing = false;
            this.processingPromise = null;
            
            // If there are remaining items, schedule next batch
            if (this.queue.size > 0) {
                this.scheduleProcessing();
            }
        }
    }
}

const batchProcessor = new BatchProcessor();

// Error handling for Redis connections
[redisSub, redisPub, redisStore].forEach(client => {
    client.on('error', (err) => {
        console.error('Redis client error:', err);
    });
});

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);
    
    for (let i = 0; i < os.cpus().length; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
        cluster.fork();
    });
} else {
    const app = uWS.App();
    
    // WeakMap to store client data - better memory management
    const clients = new WeakMap();

    // Pre-serialize common messages
    const serverEvent = (timestamp) => JSON.stringify({
        type: 'server-event',
        message: 'This is a server-side event',
        timestamp
    });

    const createResponse = (messageCount) => JSON.stringify({
        type: 'response',
        message: 'Message received successfully!',
        messageCount
    });

    const createErrorResponse = (error) => JSON.stringify({
        type: 'error',
        message: 'Failed to process message',
        error: error.message
    });

    // Utility function to safely send messages
    const safeSend = (ws, message) => {
        try {
            if (ws && clients.get(ws)?.isOpen) {
                ws.send(message);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error sending message:', error);
            return false;
        }
    };

    app.ws('/*', {
        compression: uWS.SHARED_COMPRESSOR,
        maxPayloadLength: 1024 * 1024,
        idleTimeout: 300, // 10 minute timeout
        
        open: (ws) => {
            try {
                const sessionId = uuid.v4();
                connectionCount++;
                const clientData = { 
                    sessionId,
                    messageCount: 0,
                    isOpen: true,
                    lastActivity: Date.now()
                };
                clients.set(ws, clientData);
                ws.subscribe('broadcast');
                
                safeSend(ws, JSON.stringify({ 
                    type: 'session', 
                    sessionId,
                    timestamp: new Date().toISOString()
                }));
                
                console.log(`New connection established: ${sessionId}, Total connections: ${connectionCount}`);
            } catch (error) {
                console.error('Error in open handler:', error);
                safeSend(ws, createErrorResponse(error));
            }
        },

        message: async (ws, message, isBinary) => {
            const clientData = clients.get(ws);
            if (!clientData || !clientData.isOpen) {
                console.warn('Message received for invalid/closed connection');
                return;
            }

            try {
                if (isBinary) {
                    throw new Error('Binary messages are not supported');
                }

                clientData.lastActivity = Date.now();
                clientData.messageCount++;
                const sessionKey = `session:${clientData.sessionId}`;
                
                // Use Promise.race with a timeout
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Redis operation timed out')), 5000)
                );

                const redisOperation = async () => {
                    const pipeline = redisStore.pipeline();
                    pipeline.hincrby(sessionKey, 'messageCount', 1);
                    pipeline.hget(sessionKey, 'messageCount');
                    const results = await pipeline.exec();
                    return results[1][1]; // Get the result of hget
                };

                const storedCount = await Promise.race([redisOperation(), timeoutPromise]);
                
                if (clientData.isOpen) {
                    safeSend(ws, createResponse(parseInt(storedCount, 10)));
                }
            } catch (error) {
                console.error('Error in message handler:', error);
                
                // Only attempt to send error response if connection is still open
                if (clientData.isOpen) {
                    safeSend(ws, createErrorResponse(error));
                }
            }
        },

        close: (ws, code, message) => {
            try {
                const clientData = clients.get(ws);
                if (clientData) {
                    console.log(`Connection closed: ${clientData.sessionId}, Code: ${code}, Total connections: ${--connectionCount}`);
                    clientData.isOpen = false;
                    
                    // Add to batch processor instead of immediate deletion
                    batchProcessor.add(clientData.sessionId);
                    clients.delete(ws);
                }
            } catch (error) {
                console.error('Error in close handler:', error);
            }
        },

        drain: (ws) => {
            const bufferedAmount = ws.getBufferedAmount();
            if (bufferedAmount > 1024 * 1024) { // 1MB threshold
                console.warn('High WebSocket backpressure:', bufferedAmount);
            }
        }
    });

    app.listen(port, (listenSocket) => {
        if (listenSocket) {
            console.log(`Worker ${process.pid}: WebSocket server running on port ${port}`);
        } else {
            console.error(`Worker ${process.pid}: Failed to listen on port ${port}`);
        }
    });

    // Handle Redis subscriptions
    redisSub.subscribe('server-event').catch(err => {
        console.error('Redis subscription error:', err);
    });

    redisSub.on('message', (channel, message) => {
        if (channel === 'server-event') {
            app.publish('broadcast', message);
        }
    });

    // Server-side event broadcaster
    /*
    let executionCount = 0;
    const maxExecutions = 2;
    
    const intervalId = setInterval(() => {
        if (executionCount < maxExecutions) {
            const event = serverEvent(new Date().toISOString());
            redisPub.publish('server-event', event).catch(err => {
                console.error('Failed to publish server event:', err);
            });
            executionCount++;
        } else {
            clearInterval(intervalId); // Stop the interval after two executions
        }
    }, 10000);
*/
}