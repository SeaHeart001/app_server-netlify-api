// Ably 订阅桥（Edge / Express 共用）
//
// 背景：Netlify Edge Functions 运行在多隔离环境（isolate）中，
// channelStore 的内存连接表只对本 isolate（或 Express 单进程）可见。
// 发布端改为经 Ably 全球骨干扇出（见 utils/messages.js 的 publishViaAbly）后，
// 每个运行环境只需要订阅“自己持有 SSE 连接的用户”的频道，
// 收到事件后在本地投递即可，从而保证消息可靠到达。
//
// 接入点：Netlify 侧 netlify/edge-functions/sse.js，
// Express 侧 routers/sse.js，两处逻辑对称。
//
// 频道约定：每个用户一个频道 `user:{userId}`，消息名固定 `realtime`，
// 与发布端保持一致。
//
// 实现方式：使用 Ably 的频道 SSE 导出端点（纯 fetch 流式读取，不引入 SDK），
// 断流后指数退避自动重连；isolate 内该用户不再持有任何连接时释放订阅。
//
// 未配置 ABLY_API_KEY 时，本模块所有方法均为空操作，
// 系统回退到原有的 HTTP 直推 SSE 端点通道（Express / 本地开发）。

import {publishToRealtimeClients, getUserClientCount} from './channelStore.mjs';

const ABLY_REALTIME_HOST = 'https://realtime.ably.io';
const MESSAGE_EVENT_NAME = 'realtime';
const ABLY_API_VERSION = '1.2';

// 重连退避参数：1s、2s、4s ... 封顶 30s
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const SUBSCRIPTION_READY_TIMEOUT = 8000;

// 释放宽限期：同一 clientId 新旧连接快速替换时，
// 避免订阅被反复销毁重建；宽限期结束后复查连接数再真正释放
const RELEASE_GRACE_MS = 5000;

// isolate 内的订阅状态表：userId -> {closed, attempts, abortController, releaseTimer, lastEventId}
const subscriptions = new Map();

// Edge 环境读取环境变量的兼容方式（Netlify 运行时 / Deno 运行时 / Node 本地验证）
function getApiKey() {
    const netlify = globalThis.Netlify;
    if (netlify && netlify.env && typeof netlify.env.get === 'function') {
        return netlify.env.get('ABLY_API_KEY');
    }

    const deno = globalThis.Deno;
    if (deno && deno.env && typeof deno.env.get === 'function') {
        return deno.env.get('ABLY_API_KEY');
    }

    const proc = globalThis.process;
    if (proc && proc.env) {
        return proc.env.ABLY_API_KEY;
    }

    return undefined;
}

export function isAblyConfigured() {
    return Boolean(getApiKey());
}

function getChannelName(userId) {
    return `user:${userId}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForSubscriptionReady(state) {
    if (state.ready) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Ably subscription did not become ready in time'));
        }, SUBSCRIPTION_READY_TIMEOUT);

        state.readyPromise.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

// 确保本 isolate 已订阅指定用户的频道。
// 幂等：已有订阅时仅取消待执行的释放定时器（新连接到来，继续维持订阅）
export function ensureUserSubscription(userId, logger = console) {
    if (!isAblyConfigured() || !userId) {
        return Promise.resolve();
    }

    const existing = subscriptions.get(userId);
    if (existing) {
        if (existing.releaseTimer) {
            clearTimeout(existing.releaseTimer);
            existing.releaseTimer = null;
        }
        return waitForSubscriptionReady(existing);
    }

    let resolveReady;
    const state = {
        closed: false,
        attempts: 0,
        abortController: null,
        releaseTimer: null,
        lastEventId: '',
        ready: false,
        readyPromise: new Promise(resolve => {
            resolveReady = resolve;
        }),
        resolveReady
    };
    subscriptions.set(userId, state);

    if (logger && typeof logger.info === 'function') {
        logger.info('Ably subscription started', {userId});
    }

    void runSubscriptionLoop(userId, state, logger);
    return waitForSubscriptionReady(state);
}

// 请求释放订阅：仅当本 isolate 不再持有该用户任何连接时生效。
// 延迟一个宽限期后复查，防止连接替换期间误释放
export function releaseUserSubscription(userId, logger = console) {
    const state = subscriptions.get(userId);
    if (!state || state.releaseTimer) {
        return;
    }

    if (getUserClientCount(userId) > 0) {
        return;
    }

    state.releaseTimer = setTimeout(() => {
        state.releaseTimer = null;

        // 宽限期内来了新连接时，ensureUserSubscription 会取消本定时器，
        // 能走到这里说明该用户确实没有连接了
        if (getUserClientCount(userId) > 0) {
            return;
        }

        subscriptions.delete(userId);
        state.closed = true;
        if (state.abortController) {
            state.abortController.abort();
        }

        if (logger && typeof logger.info === 'function') {
            logger.info('Ably subscription released', {userId});
        }
    }, RELEASE_GRACE_MS);
}

// 订阅主循环：建立到 Ably SSE 导出端点的流式连接，
// 流正常结束或异常中断后按指数退避重连，直到订阅被释放
async function runSubscriptionLoop(userId, state, logger) {
    while (!state.closed) {
        try {
            state.abortController = new AbortController();
            const params = new URLSearchParams({
                channels: getChannelName(userId),
                v: ABLY_API_VERSION
            });
            if (state.lastEventId) {
                params.set('lastEvent', state.lastEventId);
            }
            const url = `${ABLY_REALTIME_HOST}/sse?${params.toString()}`;

            const res = await fetch(url, {
                headers: {
                    authorization: `Basic ${btoa(getApiKey())}`,
                    accept: 'text/event-stream'
                },
                signal: state.abortController.signal
            });

            const contentType = res.headers.get('content-type') || '';
            if (!res.ok || !res.body || !contentType.toLowerCase().startsWith('text/event-stream')) {
                throw new Error(`Ably SSE responded ${res.status}`);
            }

            // 连接成功，重置退避计数
            state.attempts = 0;
            if (!state.ready) {
                state.ready = true;
                state.resolveReady();
            }
            await readSseStream(res.body, frame => {
                if (frame.id) {
                    state.lastEventId = frame.id;
                }
                handleSseFrame(userId, frame);
            });
            // 流正常结束（Ably 会周期性关闭旧连接），继续走重连
        } catch (err) {
            if (state.closed) {
                return;
            }

            if (logger && typeof logger.warn === 'function') {
                logger.warn('Ably subscription interrupted', {
                    userId,
                    error: err && err.message ? err.message : String(err)
                });
            }
        }

        if (state.closed) {
            return;
        }

        const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, state.attempts), RECONNECT_MAX_DELAY);
        state.attempts += 1;
        await sleep(delay);
    }
}

// 按帧读取 SSE 流：SSE 帧以空行分隔，
// 解析出 event / data 字段后交给回调处理
async function readSseStream(body, onFrame) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, {stream: true});

            let separator = /\r?\n\r?\n/.exec(buffer);
            while (separator) {
                const rawFrame = buffer.slice(0, separator.index);
                buffer = buffer.slice(separator.index + separator[0].length);

                const frame = parseSseFrame(rawFrame);
                if (frame) {
                    onFrame(frame);
                }

                separator = /\r?\n\r?\n/.exec(buffer);
            }
        }
    } finally {
        reader.releaseLock();
    }
}

function parseSseFrame(rawFrame) {
    let eventName = 'message';
    let eventId = '';
    const dataLines = [];

    rawFrame.split(/\r?\n/).forEach(line => {
        if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('id:')) {
            eventId = line.slice('id:'.length).replace(/^ /, '');
        } else if (line.startsWith('data:')) {
            // SSE 规范：冒号后最多去掉一个前导空格
            dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
        }
    });

    if (!dataLines.length) {
        return null;
    }

    return {event: eventName, id: eventId, data: dataLines.join('\n')};
}

// 处理一帧 Ably SSE 事件：仅关心 name 为 `realtime` 的 message 事件，
// 解码出业务负载后交给本地连接表投递。
// 重复投递由 channelStore 内的 sentIds 去重兜底
function handleSseFrame(userId, frame) {
    // Ably 还会推送 heartbeat 等控制帧，直接忽略
    if (!frame || frame.event !== 'message') {
        return;
    }

    let envelope;
    try {
        envelope = JSON.parse(frame.data);
    } catch (err) {
        return;
    }

    if (!envelope || envelope.name !== MESSAGE_EVENT_NAME) {
        return;
    }

    // 发布端以 JSON 字符串形式写入 data，这里还原为对象
    let payload = envelope.data;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch (err) {
            return;
        }
    }

    if (!payload) {
        return;
    }

    publishToRealtimeClients([String(userId)], payload);
}
