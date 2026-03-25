/**
 * @memoryblock/api — Lightweight HTTP + WebSocket API server.
 * 
 * Zero external dependencies — uses Node.js built-in http module.
 * Designed for the memoryblock web UI and third-party integrations.
 */

export { ApiServer, type ApiServerConfig } from './server.js';
export { generateAuthToken, validateAuthToken } from './auth.js';