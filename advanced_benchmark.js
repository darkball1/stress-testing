const WebSocket = require('ws');
const { performance } = require('perf_hooks');
const fs = require('fs');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');


// Connection management constants
const BATCH_SIZE = 1000; // Connections per batch
const BATCH_INTERVAL = 1000; // ms between batches
const MAX_ACTIVE_BATCHES = 50; // Number of concurrent batches
const CONNECTION_TIMEOUT = 10000; // 10 seconds
const MEMORY_CHECK_INTERVAL = 2000; // 2 seconds
const MAX_MEMORY_USAGE = 0.85; // 85% of available memory
const WS_SERVER_URL = 'ws://localhost/ws';
const MESSAGES_PER_CLIENT = 30;

// Performance monitoring
const metrics = {
    activeConnections: 0,
    failedConnections: 0,
    completedConnections: 0,
    currentMemoryUsage: 0,
    batchesInProgress: 0,
    avgLatency: 0,
    avgLatencyLength: 0,
    responsesReceived: 0,
    onlyResponsesReceived: 0,
    totalSessionCount: 0,
    messagesSent: 0,
    serverEvent: 0,
    lastSentTime: 1,
    latencyStats: []
};

class ConnectionBatch {
    constructor(batchId, size) {
        this.batchId = batchId;
        this.size = size;
        this.connections = new Map();
        this.startTime = Date.now();
        this.metrics = {
            successCount: 0,
            failureCount: 0,
            latencies: [],
            sessionStats: new Map()
        };
    }

    addLatency(clientId, latency) {
        this.metrics.latencies.push(latency);
        
        // Update session-specific metrics
        if (!this.metrics.sessionStats.has(clientId)) {
            this.metrics.sessionStats.set(clientId, {
                latencies: [],
                startTime: Date.now(),
                messageCount: 0
            });
        }
        
        const sessionStats = this.metrics.sessionStats.get(clientId);
        sessionStats.latencies.push(latency);
        metrics.avgLatency = ((metrics.avgLatency * metrics.avgLatencyLength) + latency) / (metrics.avgLatencyLength + 1)
        metrics.avgLatencyLength += 1
    }

    cleanup() {
        this.connections.clear();
    }
}    

class HighScaleConnectionManager {
    constructor() {
        this.batches = new Map();
        this.connectionQueue = [];
        this.activeBatchCount = 0;
        this.currentBatchId = 0;
        this.isProcessingQueue = false;
        this.setupMemoryMonitoring();
    }

    setupMemoryMonitoring() {
        setInterval(() => {
            const memUsage = process.memoryUsage();
            metrics.currentMemoryUsage = memUsage.heapUsed / memUsage.heapTotal;
            
            if (metrics.currentMemoryUsage > MAX_MEMORY_USAGE) {
                this.throttleConnections();
            }
        }, MEMORY_CHECK_INTERVAL);
    }

    throttleConnections() {
        // Increase delay between batches when memory usage is high
        const currentBatches = Array.from(this.batches.values());
        const oldestBatch = currentBatches.sort((a, b) => a.startTime - b.startTime)[0];
        
        if (oldestBatch) {
            this.cleanupBatch(oldestBatch.batchId);
        }
    }

    async processBatch(batchId, connections) {
        const batch = new ConnectionBatch(batchId, connections.length);
        this.batches.set(batchId, batch);
        this.activeBatchCount++;
        metrics.batchesInProgress++;

        try {
            const batchPromises = connections.map(async (conn) => {
                try {
                    await this.establishConnection(conn, batch);
                    batch.metrics.successCount++;
                } catch (error) {
                    batch.metrics.failureCount++;
                    metrics.failedConnections++;
                }
            });

            await Promise.all(batchPromises);
        } finally {
            this.activeBatchCount--;
            metrics.batchesInProgress--;
            this.cleanupBatch(batchId);
        }
    }

    cleanupBatch(batchId) {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.cleanup();
            this.batches.delete(batchId);
            let length = 0
            let latencySum = 0
            // Update global metrics
            
            for (const clientId of batch.metrics.sessionStats.keys()) {
                const sessionStats = batch.metrics.sessionStats.get(clientId);
                if (sessionStats) {
                    const latencies = sessionStats.latencies;
                    if (latencies.length > 0) {
                        // Calculate session-specific metrics
                        const sorted = [...latencies].sort((a, b) => a - b);
                        const sessionMetrics = {
                            avg: latencies.reduce((a, b) => a + b) / latencies.length,
                            median: sorted[Math.floor(sorted.length / 2)],
                            min: sorted[0],
                            max: sorted[sorted.length - 1],
                        };
                    
                        
                        // Add to global session stats
                        metrics.latencyStats.push(sessionMetrics);
                        
                    }
                    batch.metrics.sessionStats.delete(clientId);
                }
            }
            
            metrics.completedConnections += batch.metrics.successCount;
            
        }
    }

    async queueConnections(connections) {
        this.connectionQueue.push(...connections);
        if (!this.isProcessingQueue) {
            this.isProcessingQueue = true;
            await this.processQueue();
        }
    }

    async processQueue() {
        while (this.connectionQueue.length > 0 && this.activeBatchCount < MAX_ACTIVE_BATCHES) {
            const batch = this.connectionQueue.splice(0, BATCH_SIZE);
            const batchId = this.currentBatchId++;

            this.processBatch(batchId, batch);
            await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL));
        }
        
        this.isProcessingQueue = false;
        
        // If there are remaining connections, schedule next batch
        if (this.connectionQueue.length > 0) {
            setTimeout(() => this.processQueue(), BATCH_INTERVAL);
        }
    }

    async establishConnection(clientId, batch) {
        return new Promise(async (resolve, reject) => {
            let ws;
            let connectionTimeout;
            let messagesSent = 0;
            let responsesReceived = 0;
            let responseStartTime = performance.now()

            const cleanup = () => {
                if (connectionTimeout) clearTimeout(connectionTimeout);
                if (ws) {
                    ws.removeAllListeners();
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close();
                    }
                }
                metrics.activeConnections--;
            };

            try {
                ws = new WebSocket(WS_SERVER_URL, {
                    perMessageDeflate: false, // Disable compression for better performance
                    maxPayload: 1024 * 16 // Limit message size to 16KB
                });

                metrics.activeConnections++;

                // Set connection timeout
                connectionTimeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Connection timeout'));
                }, CONNECTION_TIMEOUT);

                ws.on('open', () => {
                    clearTimeout(connectionTimeout);
                    const startTime = performance.now();

                    ws.on('message', async (data) => {
                        try {
                            const response = JSON.parse(data);
                            if (response.type === 'response' || response.type === 'session'){
                                responsesReceived++;
                                metrics.responsesReceived++

                                if (response.type === 'response'){
                                    metrics.onlyResponsesReceived++
                                    const latency = performance.now() - responseStartTime;
                                    batch.addLatency(clientId, latency);
                                }

                                if (response.type === 'session'){
                                    metrics.totalSessionCount++
                                    const latency = performance.now() - startTime;
                                    batch.addLatency(clientId, latency);
                                }
                                
                                
    
                                if (responsesReceived >= MESSAGES_PER_CLIENT + 1) {
                                    cleanup();
                                    resolve();
                                }
                            } else if (response.type === 'server-event'){
                                metrics.serverEvent++   
                            }
                            
                        } catch (error) {
                            cleanup();
                            reject(error);
                        }
                    });

                    // Send messages with rate limiting
                    const sendMessages = async () => {
                        while (messagesSent < MESSAGES_PER_CLIENT) {
                            if (ws.readyState !== WebSocket.OPEN) break;
                            
                            //const randomDelay = Math.floor(Math.random() * (180000 + 1)) + 50;
                            // Rate limiting
                            //await new Promise(resolve => setTimeout(resolve, 5));
                            responseStartTime = performance.now();
                            metrics.lastSentTime = responseStartTime;
                            try {
                                ws.send(JSON.stringify({
                                    clientId,
                                    messageId: messagesSent,
                                }));
                                messagesSent++;
                                metrics.messagesSent++;

                            } catch (error) {
                                cleanup();
                                reject(error);
                                return;
                            }
                        }
                    };

                    sendMessages();
                });

                ws.on('error', (error) => {

                    cleanup();
                    reject(error);
                });

                ws.on('close', () => {
                    cleanup();
                    if (responsesReceived < MESSAGES_PER_CLIENT) {
                        reject(new Error('Connection closed prematurely'));
                    } else {
                        resolve();
                    }
                });

            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    getMetrics() {
        return {
            ...metrics,
            queueLength: this.connectionQueue.length,
            activeBatches: this.activeBatchCount
        };
    }
}

// Usage example
async function runHighScaleTest(totalConnections = 50000) {
    const connectionManager = new HighScaleConnectionManager();
    const clients = Array.from({ length: totalConnections }, (_, i) => i);
    const startTime = performance.now();
    let memoryUsage = []
    console.log(`Starting high-scale test with ${totalConnections} connections`);
    
    // Setup metrics logging
    const metricsInterval = setInterval(() => {
        const currentMetrics = connectionManager.getMetrics();
        memoryUsage.push(currentMetrics.currentMemoryUsage * 100)
        console.log(`
Current Metrics:
Total Sessions: ${currentMetrics.totalSessionCount}
Total Messages Sent: ${metrics.messagesSent}
Total Responses Received: ${metrics.responsesReceived}
Average Latency: ${(metrics.avgLatency).toFixed(2)}ms
Throughput: ${(1000 * metrics.responsesReceived / metrics.lastSentTime).toFixed(2)} messages/second
Memory Usage: ${(currentMetrics.currentMemoryUsage * 100).toFixed(2)}%
Queued Connections: ${currentMetrics.queueLength}
Batches in Progress: ${metrics.batchesInProgress}
        `);
    }, 2500);

    try {
        await connectionManager.queueConnections(clients);
        
        // Wait for all connections to complete
        while (connectionManager.getMetrics().activeConnections > 0 || 
               connectionManager.getMetrics().queueLength > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        clearInterval(metricsInterval);
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000; // Convert to seconds

        
        // Final metrics
        const finalMetrics = connectionManager.getMetrics();
        let resultsText = `
Benchmark Results:
Total Sessions: ${metrics.totalSessionCount}
Total Failed Connections: ${totalConnections - metrics.totalSessionCount} 
Total Failure In Responses: ${metrics.messagesSent - metrics.onlyResponsesReceived}
Average Latency: ${(metrics.avgLatency).toFixed(2)}ms
Total Messages Sent: ${metrics.messagesSent}
Total Responses Received: ${metrics.responsesReceived}
Total Server Event: ${metrics.serverEvent}
Duration: ${duration.toFixed(2)} seconds
Throughput: ${(1000 * metrics.responsesReceived / metrics.lastSentTime).toFixed(2)} messages/second

Memory Usage:
Average memory usage: ${(memoryUsage.reduce((sum, val) => sum + val, 0) / memoryUsage.length).toFixed(2)} %
Maximum memory usage: ${Math.max(...memoryUsage).toFixed(2)} %
Minimum memory usage: ${Math.min(...memoryUsage).toFixed(2)} %

        `;
        console.log(resultsText);
        // Write results to file
        fs.writeFileSync('results.txt', resultsText, (err) => {
            if (err) {
                console.error('Error writing results to file:', err);
            } else {
                console.log('Results written to file successfully.');
            }
        });

        const width = 1600;
        const height = 600;
        const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
        const latencyMetrics = {
            avg: metrics.latencyStats.map(stat => stat.avg),
            median: metrics.latencyStats.map(stat => stat.median),
            min: metrics.latencyStats.map(stat => stat.min),
            max: metrics.latencyStats.map(stat => stat.max),
        };


        // Generate latency charts
        await generateLineChart(chartJSNodeCanvas, 'Memory Usage (%)', memoryUsage, 'memory-usage-chart.png');
        await generateLineChart(chartJSNodeCanvas, 'Average Latency (ms)', latencyMetrics.avg, 'avg-latency-chart.png');
        await generateLineChart(chartJSNodeCanvas, 'Median Latency (ms)', latencyMetrics.median, 'median-latency-chart.png');
        await generateLineChart(chartJSNodeCanvas, 'Minimum Latency (ms)', latencyMetrics.min, 'min-latency-chart.png');
        await generateLineChart(chartJSNodeCanvas, 'Maximum Latency (ms)', latencyMetrics.max, 'max-latency-chart.png');
    } catch (error) {
        clearInterval(metricsInterval);
        console.error('Test failed:', error);
    }
}

async function generateLineChart(chartJSNodeCanvas, label, data, fileName) {
    const configuration = {
        type: 'line',
        data: {
            labels: Array.from({ length: data.length }, (_, i) => `Client ${i}`),
            datasets: [
                {
                    label: label,
                    data: data,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true,
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: label
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Client'
                    }
                }
            }
        }
    };

    const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync(fileName, buffer);
    console.log(`${label} chart saved to ${fileName}`);
}


runHighScaleTest()