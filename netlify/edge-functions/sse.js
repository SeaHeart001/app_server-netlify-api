const encoder = new TextEncoder();
const state = globalThis.__wxSseState || {
    channels: new Map()
};

globalThis.__wxSseState = state;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sse-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
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

function base64UrlToString(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
}

function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyJwt(token) {
    const secret = getEnv('JWT_SECRET') || getEnv('SECRET');
    if (!secret) {
        throw new Error('服务配置缺少 JWT_SECRET');
    }

    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        throw new Error('身份信息异常或已过期');
    }

    const [header, payload, signature] = parts;
    const parsedHeader = JSON.parse(base64UrlToString(header));
    if (parsedHeader.alg !== 'HS256') {
        throw new Error('身份信息异常或已过期');
    }

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        {name: 'HMAC', hash: 'SHA-256'},
        false,
        ['sign']
    );
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${payload}`));
    const expectedSignature = arrayBufferToBase64Url(signed);

    if (expectedSignature !== signature) {
        throw new Error('身份信息异常或已过期');
    }

    const decoded = JSON.parse(base64UrlToString(payload));
    if (!decoded || decoded.type !== 'wxuser' || !decoded.id) {
        throw new Error('身份信息异常或已过期');
    }

    if (decoded.exp && Math.floor(Date.now() / 1000) >= Number(decoded.exp)) {
        throw new Error('身份信息异常或已过期');
    }

    return decoded;
}

function getToken(request) {
    const auth = request.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : '';

    if (token) {
        return token;
    }

    return new URL(request.url).searchParams.get('token') || '';
}

function writeEvent(controller, name, data) {
    controller.enqueue(encoder.encode(`event: ${name}\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data || {})}\n\n`));
}

function addClient(userId, client) {
    const key = String(userId);
    const clients = state.channels.get(key) || new Set();
    clients.add(client);
    state.channels.set(key, clients);
}

function removeClient(userId, client) {
    const key = String(userId);
    const clients = state.channels.get(key);
    if (!clients) {
        return;
    }

    clients.delete(client);
    if (!clients.size) {
        state.channels.delete(key);
    }
}

async function sendPendingEvents(request, controller, token) {
    const url = new URL('/.netlify/functions/wxusers/events', request.url);
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: '{}'
    });

    if (!res.ok) {
        writeEvent(controller, 'error', {message: '未处理消息获取失败'});
        return;
    }

    const data = await res.json();
    (data.events || []).forEach(event => {
        writeEvent(controller, 'message', event);
    });
}

async function openStream(request) {
    const token = getToken(request);
    const decoded = await verifyJwt(token);
    const userId = String(decoded.id);

    let cleanup = function () {};
    const body = new ReadableStream({
        start(controller) {
            const client = {
                send(event) {
                    writeEvent(controller, 'message', event);
                }
            };
            let closed = false;

            cleanup = function () {
                if (closed) {
                    return;
                }

                closed = true;
                clearInterval(heartbeat);
                removeClient(userId, client);
                try {
                    controller.close();
                } catch (err) {
                    // The stream may already be closed by the runtime.
                }
            };

            const heartbeat = setInterval(() => {
                try {
                    writeEvent(controller, 'heartbeat', {at: Date.now()});
                } catch (err) {
                    cleanup();
                }
            }, 25000);

            addClient(userId, client);
            writeEvent(controller, 'ready', {userId, at: Date.now()});
            sendPendingEvents(request, controller, token).catch(err => {
                writeEvent(controller, 'error', {message: err && err.message ? err.message : '未处理消息获取失败'});
            });

            request.signal.addEventListener('abort', cleanup);
        },
        cancel() {
            cleanup();
        }
    });

    return new Response(body, {
        status: 200,
        headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    });
}

async function publish(request) {
    const secret = getEnv('SSE_PUBLISH_SECRET') || getEnv('JWT_SECRET') || getEnv('SECRET');
    const providedSecret = request.headers.get('x-sse-secret') || '';

    if (!secret || providedSecret !== secret) {
        return jsonResponse(401, {message: '无权发布消息'});
    }

    const body = await request.json().catch(() => ({}));
    const event = body.event;
    const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [];

    if (!event || !userIds.length) {
        return jsonResponse(400, {message: '缺少发布参数'});
    }

    let delivered = 0;
    userIds.forEach(userId => {
        const clients = state.channels.get(String(userId));
        if (!clients) {
            return;
        }

        Array.from(clients).forEach(client => {
            try {
                client.send(event);
                delivered += 1;
            } catch (err) {
                clients.delete(client);
            }
        });
    });

    return jsonResponse(200, {ok: true, delivered});
}

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response('', {
            status: 204,
            headers: corsHeaders
        });
    }

    try {
        if (request.method === 'POST') {
            return await publish(request);
        }

        if (request.method === 'GET') {
            return await openStream(request);
        }

        return jsonResponse(405, {message: '请求方法不支持'});
    } catch (err) {
        return jsonResponse(err && err.message === '身份信息异常或已过期' ? 401 : 500, {
            message: err && err.message ? err.message : 'SSE 服务异常'
        });
    }
}

export const config = {
    path: '/.netlify/edge-functions/sse'
};
