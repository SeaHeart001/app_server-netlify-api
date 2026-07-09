export const HEARTBEAT_INTERVAL = 15000;
export const EVENT_PADDING = `:${' '.repeat(2048)}\n\n`;

export const SSE_EVENTS = {
    READY: 'ready',
    HEARTBEAT: 'heartbeat',
    MESSAGE: 'message'
};

export const SSE_CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sse-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export const SSE_STREAM_HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
};
