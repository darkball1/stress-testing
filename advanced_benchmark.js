const WebSocket = require('ws');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const fs = require('fs');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

class WebSocketPool extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = {
            url: options.url || 'ws://localhost/ws',
            // Increased max connections per batch for higher parallelism
            batchSize: options.batchSize || 1000,
            batchInterval: options.batchInterval || 1000,
            acquireTimeout: options.acquireTimeout || 15000,
            messagesPerClient: options.messagesPerClient || 40,
            maxConcurrentBatches: options.maxConcurrentBatches || 10,
            messageSendInterval: options.messageSendInterval || 20,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            keepAlive: true,
            keepAliveInterval: 30000,
            ...options
        };

        // Use Set for faster lookups
        this.activeConnections = new Set();
        this.pendingBatches = new Set();
        
        this.metrics = {
            totalConnections: 0,
            activeConnections: 0,
            failedConnections: 0,
            messagesSent: 0,
            responsesReceived: 0,
            avgLatency: 0,
            avgLatencyLength: 0,
            latencyStats: [],
            memoryUsage: [],
            lastSentTime: performance.now(),
            batchesInProgress: 0,
            serverEvents: 0,
            retries: 0,
            batchThroughput: []
        };
    }

    async createConnection(clientId, retryCount = 0) {
        try {
            const ws = new WebSocket(this.options.url, {
                perMessageDeflate: false, // Disable compression for better performance
                maxPayload: 1024 * 16,
                handshakeTimeout: this.options.acquireTimeout,
                // Enable TCP keep-alive
                keepAlive: this.options.keepAlive,
                keepAliveInterval: this.options.keepAliveInterval
            });

            return new Promise((resolve, reject) => {
                const startTime = performance.now();
                let messagesSent = 0;
                let responsesReceived = 0;
                let responseStartTime = performance.now();
                const sessionStats = {
                    latencies: [],
                    startTime: Date.now(),
                    messageCount: 0
                };

                const cleanup = () => {
                    this.activeConnections.delete(ws);
                    this.metrics.activeConnections = this.activeConnections.size;
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close();
                    }
                };

                ws.on('open', () => {
                    this.activeConnections.add(ws);
                    this.metrics.activeConnections = this.activeConnections.size;
                    this.metrics.totalConnections++;

                    // Implement message batching
                    const messages = Array.from(
                        { length: this.options.messagesPerClient },
                        (_, i) => ({
                            clientId,
                            messageId: i,
                        })
                    );

                    const sendBatchedMessages = async () => {
                        const batchStartTime = performance.now();
                        
                        for (const msg of messages) {
                            if (ws.readyState !== WebSocket.OPEN) break;
                            
                            responseStartTime = performance.now();
                            this.metrics.lastSentTime = responseStartTime;
                            
                            try {
                                ws.send(JSON.stringify(msg));
                                messagesSent++;
                                this.metrics.messagesSent++;

                                if (this.options.messageSendInterval > 0) {
                                    await new Promise(resolve => 
                                        setTimeout(resolve, this.options.messageSendInterval)
                                    );
                                }
                            } catch (error) {
                                cleanup();
                                reject(error);
                                return;
                            }
                        }
                        
                        const batchDuration = performance.now() - batchStartTime;
                        this.metrics.batchThroughput.push(
                            messages.length / (batchDuration / 1000)
                        );
                    };

                    // Use setImmediate for non-blocking message sending
                    setImmediate(sendBatchedMessages);
                });

                ws.on('message', (data) => {
                    try {
                        const response = JSON.parse(data);
                        if (response.type === 'response' || response.type === 'session') {
                            responsesReceived++;
                            this.metrics.responsesReceived++;

                            if (response.type === 'response') {
                                const latency = performance.now() - responseStartTime;
                                sessionStats.latencies.push(latency);
                                
                                // Use more efficient latency calculation
                                const weight = 1 / (this.metrics.avgLatencyLength + 1);
                                this.metrics.avgLatency = 
                                    this.metrics.avgLatency * (1 - weight) + latency * weight;
                                this.metrics.avgLatencyLength++;
                            }

                            if (responsesReceived >= this.options.messagesPerClient + 1) {
                                // Calculate statistics in a single pass
                                const sorted = sessionStats.latencies.sort((a, b) => a - b);
                                const sum = sorted.reduce((a, b) => a + b, 0);
                                
                                this.metrics.latencyStats.push({
                                    avg: sum / sorted.length,
                                    median: sorted[Math.floor(sorted.length / 2)],
                                    min: sorted[0],
                                    max: sorted[sorted.length - 1]
                                });
                                
                                cleanup();
                                resolve();
                            }
                        } else if (response.type === 'server-event') {
                            this.metrics.serverEvents++;
                        }
                    } catch (error) {
                        cleanup();
                        reject(error);
                    }
                });

                ws.on('error', async (error) => {
                    cleanup();
                    if (retryCount < this.options.maxRetries) {
                        this.metrics.retries++;
                        await new Promise(resolve => 
                            setTimeout(resolve, this.options.retryDelay)
                        );
                        try {
                            await this.createConnection(clientId, retryCount + 1);
                            resolve();
                        } catch (retryError) {
                            reject(retryError);
                        }
                    } else {
                        reject(error);
                    }
                });

                ws.on('close', async () => {
                    cleanup();
                    if (responsesReceived < this.options.messagesPerClient) {
                        if (retryCount < this.options.maxRetries) {
                            await new Promise(resolve => 
                                setTimeout(resolve, this.options.retryDelay)
                            );
                            try {
                                await this.createConnection(clientId, retryCount + 1);
                                resolve();
                            } catch (retryError) {
                                reject(retryError);
                            }
                        } else {
                            this.metrics.failedConnections++;
                            console.log("Connection Failed")
                        }
                    }
                });
            });

        } catch (error) {
            this.metrics.failedConnections++;
            console.error("Error message:", error.message);
        }
    }

    async processConnections(connections) {
        // Process connections in parallel batches
        const batches = [];
        for (let i = 0; i < connections.length; i += this.options.batchSize) {
            batches.push(connections.slice(i, i + this.options.batchSize));
        }

        // Use semaphore pattern for concurrent batch control
        const processBatchWithSemaphore = async (batch) => {
            while (this.pendingBatches.size >= this.options.maxConcurrentBatches) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            this.pendingBatches.add(batch);
            this.metrics.batchesInProgress++;
            
            try {
                // Process connections in batch concurrently
                const batchPromises = batch.map(clientId => 
                    this.createConnection(clientId)
                );
                await Promise.all(batchPromises);
            } finally {
                this.pendingBatches.delete(batch);
                this.metrics.batchesInProgress--;
            }
        };

        // Process all batches with controlled concurrency
        const batchPromises = batches.map(batch => 
            processBatchWithSemaphore(batch)
        );
        
        // Wait for minimum interval between batch starts
        for (const promise of batchPromises) {
            await promise;
            await new Promise(resolve => 
                setTimeout(resolve, this.options.batchInterval)
            );
        }
    }
}

async function runHighScaleTest(totalConnections = 50000) {
    const startTime = performance.now();
    console.log(`Starting high-scale test with ${totalConnections} connections`);
    
    const pool = new WebSocketPool({
        url: 'ws://localhost/ws',
        batchSize: 1000,
        batchInterval: 1000,
    });

    // Setup metrics logging
    const metricsInterval = setInterval(() => {
        const currentMemoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100;
        pool.metrics.memoryUsage.push(currentMemoryUsage);
        
        console.log(`
Current Metrics:
Total Connections: ${pool.metrics.totalConnections}
Active Connections: ${pool.metrics.activeConnections}
Total Messages Sent: ${pool.metrics.messagesSent}
Total Responses Received: ${pool.metrics.responsesReceived}
Average Latency: ${pool.metrics.avgLatency.toFixed(2)}ms
Throughput: ${(1000 * pool.metrics.responsesReceived / pool.metrics.lastSentTime).toFixed(2)} messages/second
Memory Usage: ${currentMemoryUsage.toFixed(2)}%
Batches in Progress: ${pool.metrics.batchesInProgress}
Server Events: ${pool.metrics.serverEvents}
        `);
    }, 2500);

    try {
        const clients = Array.from({ length: totalConnections }, (_, i) => i);
        await pool.processConnections(clients);
        
        // Wait for completion
        while (pool.metrics.activeConnections > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        clearInterval(metricsInterval);
        const duration = (performance.now() - startTime) / 1000;

        // Generate final report
        const memoryUsage = pool.metrics.memoryUsage;
        const resultsText = `
Benchmark Results:
Total Connections: ${pool.metrics.totalConnections}
Failed Connections: ${pool.metrics.failedConnections}
Total Messages Sent: ${pool.metrics.messagesSent}
Total Responses Received: ${pool.metrics.responsesReceived}
Average Latency: ${pool.metrics.avgLatency.toFixed(2)}ms
Duration: ${duration.toFixed(2)} seconds
Throughput: ${(1000 * pool.metrics.responsesReceived / pool.metrics.lastSentTime).toFixed(2)} messages/second
Server Events: ${pool.metrics.serverEvents}

Memory Usage:
Average: ${(memoryUsage.reduce((sum, val) => sum + val, 0) / memoryUsage.length).toFixed(2)}%
Maximum: ${Math.max(...memoryUsage).toFixed(2)}%
Minimum: ${Math.min(...memoryUsage).toFixed(2)}%
`;
        console.log(resultsText);
        fs.writeFileSync('results.txt', resultsText);

        // Generate charts
        const width = 1600;
        const height = 600;
        const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
        
        const latencyMetrics = {
            avg: pool.metrics.latencyStats.map(stat => stat.avg),
            median: pool.metrics.latencyStats.map(stat => stat.median),
            min: pool.metrics.latencyStats.map(stat => stat.min),
            max: pool.metrics.latencyStats.map(stat => stat.max)
        };

        // Generate charts
        await generateCharts(chartJSNodeCanvas, {
            memoryUsage: pool.metrics.memoryUsage,
            latencyMetrics
        });

    } catch (error) {
        clearInterval(metricsInterval);
        console.error('Test failed:', error);
    }
}

async function generateCharts(chartJSNodeCanvas, data) {
    const charts = [
        { label: 'Memory Usage (%)', data: data.memoryUsage, filename: 'memory-usage-chart.png' },
        { label: 'Average Latency (ms)', data: data.latencyMetrics.avg, filename: 'avg-latency-chart.png' },
        { label: 'Median Latency (ms)', data: data.latencyMetrics.median, filename: 'median-latency-chart.png' },
        { label: 'Minimum Latency (ms)', data: data.latencyMetrics.min, filename: 'min-latency-chart.png' },
        { label: 'Maximum Latency (ms)', data: data.latencyMetrics.max, filename: 'max-latency-chart.png' }
    ];

    for (const chart of charts) {
        const configuration = {
            type: 'line',
            data: {
                labels: Array.from({ length: chart.data.length }, (_, i) => `Client ${i}`),
                datasets: [{
                    label: chart.label,
                    data: chart.data,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: chart.label
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
        fs.writeFileSync(chart.filename, buffer);
        console.log(`${chart.label} chart saved to ${chart.filename}`);
    }
}

runHighScaleTest(50000);
