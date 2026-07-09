const state = globalThis.__realtimeChannelState || globalThis.__sseState || {
    channels: new Map()
};

globalThis.__realtimeChannelState = state;
globalThis.__sseState = state;

function getUserKey(userId) {
    return String(userId || '');
}

export function createRealtimeClient({userId, send}) {
    return {
        userId: getUserKey(userId),
        sentIds: new Set(),
        send
    };
}

export function addRealtimeClient(client) {
    if (!client || !client.userId) {
        return;
    }

    const clients = state.channels.get(client.userId) || new Set();
    clients.add(client);
    state.channels.set(client.userId, clients);
}

export function removeRealtimeClient(client) {
    if (!client || !client.userId) {
        return;
    }

    const clients = state.channels.get(client.userId);
    if (!clients) {
        return;
    }

    clients.delete(client);
    if (!clients.size) {
        state.channels.delete(client.userId);
    }
}

export function getChannelCount() {
    return state.channels.size;
}

export function getTotalClientCount() {
    let count = 0;
    state.channels.forEach(clients => {
        count += clients.size;
    });
    return count;
}

export function sendRealtimeClientEvent(client, event) {
    if (!client || !event || typeof client.send !== 'function') {
        return false;
    }

    const eventId = event.id ? String(event.id) : '';
    if (eventId && client.sentIds && client.sentIds.has(eventId)) {
        return false;
    }

    client.send(event);
    if (eventId && client.sentIds) {
        client.sentIds.add(eventId);
    }
    return true;
}

export function publishToRealtimeClients(userIds, event, options = {}) {
    const targets = Array.from(new Set((userIds || []).map(getUserKey).filter(Boolean)));
    let delivered = 0;

    targets.forEach(userId => {
        const clients = state.channels.get(userId);
        if (!clients) {
            return;
        }

        Array.from(clients).forEach(client => {
            try {
                if (sendRealtimeClientEvent(client, event)) {
                    delivered += 1;
                }
            } catch (err) {
                removeRealtimeClient(client);
                if (typeof options.onClientError === 'function') {
                    options.onClientError(err, client);
                }
            }
        });
    });

    return {
        delivered,
        targets,
        totalClients: getTotalClientCount(),
        channels: getChannelCount()
    };
}
