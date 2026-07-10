const {Message} = require('../db/model/messageModel');
const {User} = require('../db/model/userModel');

const WECHAT_API_BASE_URL = 'https://api.weixin.qq.com/cgi-bin';
const ACCESS_TOKEN_REFRESH_OFFSET = 5 * 60 * 1000;
const ACCESS_TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001]);
const SUBSCRIBE_MESSAGE_TEMPLATE_ID = '_b42cmg1CuItFk1NmjV05t6P4x2zsekt8qvg8qkGWfk';
const SUBSCRIBE_MESSAGE_PAGE = 'pages/index/index';
const SUBSCRIBE_MINIPROGRAM_STATE = 'trial';
// formal     正式版
// trial      体验版

const SUBSCRIBE_STATES = {
    NONE: 'none',
    PENDING: 'pending',
    SENT: 'sent',
    SKIPPED: 'skipped',
    FAILED: 'failed'
};

const accessTokenCache = {
    value: '',
    expiresAt: 0
};

function getEnv(name) {
    return process.env[name] || '';
}

function getTemplateId() {
    return SUBSCRIBE_MESSAGE_TEMPLATE_ID;
}

function getSubscribePage(messageEvent) {
    const payload = messageEvent && messageEvent.payload ? messageEvent.payload : {};
    return payload.subscribePage || payload.page || SUBSCRIBE_MESSAGE_PAGE;
}

function getMiniProgramState() {
    return SUBSCRIBE_MINIPROGRAM_STATE;
}

function trimTemplateValue(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function getSenderName(messageEvent) {
    const from = messageEvent && messageEvent.from ? messageEvent.from : {};
    return from.nickname || from.account || from.openid || '用户';
}

function buildSubscribeData(messageEvent) {
    return {
        thing1: {
            value: trimTemplateValue(messageEvent.title || '消息通知', 20)
        },
        thing3: {
            value: trimTemplateValue(getSenderName(messageEvent), 20)
        },
        thing5: {
            value: trimTemplateValue(messageEvent.content || '你有一条新消息', 20)
        }
    };
}

async function readWechatResponse(res) {
    const text = await res.text();
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        return {raw: text.slice(0, 500)};
    }
}

function getWechatErrorMessage(data, fallback) {
    if (!data) {
        return fallback;
    }

    return data.errmsg || data.message || data.raw || fallback;
}

async function updateSubscribeState(messageId, state, errorMessage = '') {
    if (!messageId || !Message || !Message.updateOne) {
        return;
    }

    const update = {
        subscribeState: state,
        subscribeError: errorMessage,
        updatedAt: new Date()
    };

    if (state === SUBSCRIBE_STATES.SENT) {
        update.subscribeSentAt = new Date();
    }

    await Message.updateOne({_id: messageId}, {$set: update});
}

async function getMiniProgramAccessToken() {
    const now = Date.now();
    if (accessTokenCache.value && accessTokenCache.expiresAt - ACCESS_TOKEN_REFRESH_OFFSET > now) {
        return accessTokenCache.value;
    }

    const appid = getEnv('WX_APP_ID');
    const secret = getEnv('WX_APP_SECRET');
    if (!appid || !secret) {
        throw new Error('服务配置缺少 WX_APP_ID 或 WX_APP_SECRET');
    }

    const res = await fetch(`${WECHAT_API_BASE_URL}/stable_token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify({
            grant_type: 'client_credential',
            appid,
            secret,
            force_refresh: false
        })
    });
    const data = await readWechatResponse(res);

    if (!res.ok || data.errcode) {
        throw new Error(getWechatErrorMessage(data, '小程序 access_token 获取失败'));
    }

    if (!data.access_token) {
        throw new Error('小程序 access_token 返回异常');
    }

    accessTokenCache.value = data.access_token;
    accessTokenCache.expiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
    return accessTokenCache.value;
}

function clearAccessTokenCache() {
    accessTokenCache.value = '';
    accessTokenCache.expiresAt = 0;
}

function isAccessTokenInvalid(data) {
    return data && ACCESS_TOKEN_INVALID_ERRCODES.has(Number(data.errcode));
}

async function requestSubscribeSend({accessToken, targetUser, templateId, messageEvent}) {
    const res = await fetch(`${WECHAT_API_BASE_URL}/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify({
            touser: targetUser.openid,
            template_id: templateId,
            page: getSubscribePage(messageEvent),
            data: buildSubscribeData(messageEvent),
            miniprogram_state: getMiniProgramState(),
            lang: 'zh_CN'
        })
    });
    const data = await readWechatResponse(res);

    return {res, data};
}

function shouldSendSubscribeMessage(message) {
    const channels = message && message.notifyChannels ? message.notifyChannels : [];
    return channels.map(String).includes('subscribe');
}

async function sendMiniProgramSubscribeMessage({message, messageEvent}) {
    if (!shouldSendSubscribeMessage(message)) {
        return {ok: false, skipped: true, reason: 'channel_disabled'};
    }

    const messageId = message && (message._id || message.id);
    const templateId = getTemplateId();
    if (!templateId) {
        await updateSubscribeState(messageId, SUBSCRIBE_STATES.SKIPPED, '缺少小程序订阅消息模板 ID');
        return {ok: false, skipped: true, reason: 'missing_template_id'};
    }

    const targetUserId = message && message.toUser;
    const targetUser = targetUserId ? await User.findById(targetUserId).lean() : null;
    if (!targetUser || !targetUser.openid) {
        await updateSubscribeState(messageId, SUBSCRIBE_STATES.SKIPPED, '目标用户缺少小程序 openid');
        return {ok: false, skipped: true, reason: 'missing_openid'};
    }

    await updateSubscribeState(messageId, SUBSCRIBE_STATES.PENDING);

    try {
        let accessToken = await getMiniProgramAccessToken();
        let {res, data} = await requestSubscribeSend({
            accessToken,
            targetUser,
            templateId,
            messageEvent
        });

        if ((!res.ok || data.errcode) && isAccessTokenInvalid(data)) {
            clearAccessTokenCache();
            accessToken = await getMiniProgramAccessToken();
            ({res, data} = await requestSubscribeSend({
                accessToken,
                targetUser,
                templateId,
                messageEvent
            }));
        }

        if (!res.ok || data.errcode) {
            const messageText = getWechatErrorMessage(data, '小程序订阅消息发送失败');
            await updateSubscribeState(messageId, SUBSCRIBE_STATES.FAILED, messageText);
            console.warn('Mini program subscribe message failed', {
                messageId: String(messageId || ''),
                targetUserId: String(targetUserId || ''),
                errcode: data.errcode,
                errmsg: data.errmsg || data.raw || ''
            });
            return {
                ok: false,
                failed: true,
                data
            };
        }

        await updateSubscribeState(messageId, SUBSCRIBE_STATES.SENT);
        return {
            ok: true,
            data
        };
    } catch (err) {
        const messageText = err && err.message ? err.message : '小程序订阅消息发送异常';
        await updateSubscribeState(messageId, SUBSCRIBE_STATES.FAILED, messageText);
        console.warn('Mini program subscribe message failed', messageText);
        return {
            ok: false,
            failed: true,
            error: messageText
        };
    }
}

module.exports = {
    SUBSCRIBE_MESSAGE_PAGE,
    SUBSCRIBE_MESSAGE_TEMPLATE_ID,
    SUBSCRIBE_MINIPROGRAM_STATE,
    SUBSCRIBE_STATES,
    sendMiniProgramSubscribeMessage,
    shouldSendSubscribeMessage
};
