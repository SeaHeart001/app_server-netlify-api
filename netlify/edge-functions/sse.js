import {SSE_CORS_HEADERS, SSE_STREAM_HEADERS} from '../../realtime/constants.mjs';
import {
    assertUserPayload,
    createRealtimeError,
    getClientIdFromRequestParts,
    getRealtimeErrorMessage,
    getRealtimeErrorStatus,
    getTokenFromRequestParts
} from '../../realtime/auth.mjs';
import {arrayBufferToBase64Url, decodeJwtParts} from '../../realtime/jwt.mjs';
import {encodeSseEvent} from '../../realtime/sseCodec.mjs';
import {openRealtimeSession} from '../../realtime/session.mjs';
import {publishRealtimePayload} from '../../realtime/publisher.mjs';
import {closeRealtimeClients} from '../../realtime/channelStore.mjs';
import {ensureUserSubscription, releaseUserSubscription} from '../../realtime/ablyBridge.mjs';

const encoder = new TextEncoder();

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...SSE_CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8'
        }
    });
}

function getEnv(name) {
    const netlify = globalThis.Netlify;
    if (netlify && netlify.env && typeof netlify.env.get === 'function') {
        return netlify.env.get(name);
    }

    const deno = globalThis.Deno;
    if (deno && deno.env && typeof deno.env.get === 'function') {
        return deno.env.get(name);
    }

    return undefined;
}

async function verifyJwt(token) {
    const secret = getEnv('JWT_SECRET') || getEnv('SECRET');
    if (!secret) {
        throw createRealtimeError(500, '服务配置缺少 JWT_SECRET');
    }

    const decodedToken = decodeJwtParts(token);
    if (decodedToken.header.alg !== 'HS256') {
        throw createRealtimeError(401, '身份信息异常或已过期');
    }

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        {name: 'HMAC', hash: 'SHA-256'},
        false,
        ['sign']
    );
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(decodedToken.signingInput));
    const expectedSignature = arrayBufferToBase64Url(signed);

    if (expectedSignature !== decodedToken.signature) {
        throw createRealtimeError(401, '身份信息异常或已过期');
    }

    return assertUserPayload(decodedToken.payload);
}

function getToken(request) {
    return getTokenFromRequestParts({
        authorization: request.headers.get('authorization') || '',
        url: request.url
    });
}

function writeEvent(controller, name, data) {
    controller.enqueue(encodeSseEvent(encoder, name, data));
}

async function openStream(request) {
    const decoded = await verifyJwt(getToken(request));
    const userId = String(decoded.id);
    const clientId = getClientIdFromRequestParts({
        clientId: request.headers.get('x-sse-client-id') || '',
        url: request.url
    });

    let cleanup = function () {};
    const body = new ReadableStream({
        async start(controller) {
            const sessionCleanup = openRealtimeSession({
                userId,
                clientId,
                deferReady: true,
                sendEvent(name, data) {
                    writeEvent(controller, name, data);
                },
                close() {
                    try {
                        controller.close();
                    } catch (err) {
                        // The stream may already be closed by the runtime.
                    }
                },
                logger: console,
                logLabel: 'SSE client connected'
            });

            cleanup = function () {
                sessionCleanup();
                // 本 isolate 内该用户最后一条连接关闭后释放 Ably 订阅
                // （内部带宽限期复查，连接替换时不会误释放）
                releaseUserSubscription(userId);
            };
            request.signal.addEventListener('abort', cleanup);

            // Ably：确保本 isolate 已订阅该用户的频道，
            // 发布端经 Ably 扇出的事件才能投递到这条连接。
            // 未配置 ABLY_API_KEY 时为空操作，行为退化为原内存直推
            try {
                await ensureUserSubscription(userId);
                sessionCleanup.sendReady();
            } catch (err) {
                cleanup();
                controller.error(err);
                return;
            }
        },
        cancel() {
            cleanup();
        }
    });

    return new Response(body, {
        status: 200,
        headers: {
            ...SSE_CORS_HEADERS,
            ...SSE_STREAM_HEADERS
        }
    });
}

async function publish(request) {
    const body = await request.json().catch(() => ({}));
    const result = publishRealtimePayload({
        body,
        secret: getEnv('SSE_PUBLISH_SECRET') || getEnv('JWT_SECRET') || getEnv('SECRET'),
        providedSecret: request.headers.get('x-sse-secret') || '',
        logger: console,
        logLabel: 'SSE publish'
    });

    return jsonResponse(200, result);
}

async function closeClient(request) {
    const decoded = await verifyJwt(getToken(request));
    const userId = String(decoded.id);
    const clientId = getClientIdFromRequestParts({
        clientId: request.headers.get('x-sse-client-id') || '',
        url: request.url
    });
    const result = closeRealtimeClients({userId, clientId});

    console.info('SSE client close requested', {
        userId,
        clientId,
        closed: result.closed,
        totalClients: result.totalClients,
        channels: result.channels
    });

    return jsonResponse(200, {
        ok: true,
        closed: result.closed
    });
}

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response('', {
            status: 204,
            headers: SSE_CORS_HEADERS
        });
    }

    try {
        if (request.method === 'POST') {
            return await publish(request);
        }

        if (request.method === 'DELETE') {
            return await closeClient(request);
        }

        if (request.method === 'GET') {
            return await openStream(request);
        }

        throw createRealtimeError(405, '请求方法不支持');
    } catch (err) {
        return jsonResponse(getRealtimeErrorStatus(err), {
            message: getRealtimeErrorMessage(err)
        });
    }
}

export const config = {
    path: '/.netlify/edge-functions/sse'
};
