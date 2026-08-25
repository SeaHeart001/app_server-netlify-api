const state = globalThis.__realtimeChannelState || globalThis.__sseState || {
    channels: new Map()
};

globalThis.__realtimeChannelState = state;
globalThis.__sseState = state;

function getUserKey(userId) {
    return String(userId || '');
}

function getClientKey(clientId) {
    return String(clientId || 'default');
}

export function createRealtimeClient({userId, clientId, send}) {
    return {
        userId: getUserKey(userId),
        clientId: getClientKey(clientId),
        sentIds: new Set(),
        send
    };
}

export function addRealtimeClient(client) {
    if (!client || !client.userId) {
        return {replaced: 0};
    }

    const clients = state.channels.get(client.userId) || new Set();
    let replaced = 0;

    Array.from(clients).forEach(existingClient => {
        if (existingClient === client || existingClient.clientId !== client.clientId) {
            return;
        }

        replaced += 1;
        if (typeof existingClient.close === 'function') {
            existingClient.close('replaced');
        } else {
            clients.delete(existingClient);
        }
    });

    clients.add(client);
    state.channels.set(client.userId, clients);

    return {replaced};
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

export function closeRealtimeClients({userId, clientId}) {
    const userKey = getUserKey(userId);
    const clientKey = getClientKey(clientId);
    const clients = state.channels.get(userKey);
    let closed = 0;

    if (!clients) {
        return {
            closed,
            totalClients: getTotalClientCount(),
            channels: getChannelCount()
        };
    }

    Array.from(clients).forEach(client => {
        if (client.clientId !== clientKey) {
            return;
        }

        closed += 1;
        if (typeof client.close === 'function') {
            client.close('client_offline');
        } else {
            removeRealtimeClient(client);
        }
    });

    return {
        closed,
        totalClients: getTotalClientCount(),
        channels: getChannelCount()
    };
}

export function getChannelCount() {
    return state.channels.size;
}

// 某用户在本 isolate 内当前持有的 SSE 连接数，
// 供 Ably 订阅桥判断是否需要维持/释放该用户的频道订阅
export function getUserClientCount(userId) {
    const clients = state.channels.get(getUserKey(userId));
    return clients ? clients.size : 0;
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
