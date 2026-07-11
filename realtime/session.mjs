import {HEARTBEAT_INTERVAL, SSE_EVENTS} from './constants.mjs';
import {
    addRealtimeClient,
    createRealtimeClient,
    getChannelCount,
    getTotalClientCount,
    removeRealtimeClient
} from './channelStore.mjs';

export function openRealtimeSession({userId, clientId, sendEvent, close, logger = console, logLabel = 'SSE client connected'}) {
    const client = createRealtimeClient({
        userId,
        clientId,
        send(event) {
            sendEvent(SSE_EVENTS.MESSAGE, event);
        }
    });
    let closed = false;
    let heartbeat;

    const cleanup = function () {
        if (closed) {
            return;
        }

        closed = true;
        clearInterval(heartbeat);
        removeRealtimeClient(client);

        if (typeof close === 'function') {
            close();
        }
    };

    client.close = cleanup;

    heartbeat = setInterval(() => {
        try {
            sendEvent(SSE_EVENTS.HEARTBEAT, {at: Date.now()});
        } catch (err) {
            cleanup();
        }
    }, HEARTBEAT_INTERVAL);

    const addResult = addRealtimeClient(client);
    if (logger && typeof logger.info === 'function') {
        logger.info(logLabel, {
            userId: client.userId,
            clientId: client.clientId,
            replaced: addResult.replaced || 0,
            totalClients: getTotalClientCount(),
            channels: getChannelCount()
        });
    }

    try {
        sendEvent(SSE_EVENTS.READY, {userId: client.userId, at: Date.now()});
    } catch (err) {
        cleanup();
    }

    return cleanup;
}
