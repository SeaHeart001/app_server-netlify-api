import {createRealtimeError} from './auth.mjs';
import {publishToRealtimeClients} from './channelStore.mjs';

export function assertPublishSecret(secret, providedSecret) {
    if (!secret || providedSecret !== secret) {
        throw createRealtimeError(401, '无权发布消息');
    }
}

export function normalizePublishBody(body = {}) {
    const event = body.event;
    const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [];

    if (!event || !userIds.length) {
        throw createRealtimeError(400, '缺少发布参数');
    }

    return {event, userIds};
}

export function publishRealtimePayload({body, secret, providedSecret, logger = console, logLabel = 'SSE publish'}) {
    assertPublishSecret(secret, providedSecret);

    const {event, userIds} = normalizePublishBody(body);
    const result = publishToRealtimeClients(userIds, event);

    if (logger && typeof logger.info === 'function') {
        logger.info(logLabel, {
            userIds,
            delivered: result.delivered,
            totalClients: result.totalClients,
            channels: result.channels
        });
    }

    return {
        ok: true,
        delivered: result.delivered
    };
}
