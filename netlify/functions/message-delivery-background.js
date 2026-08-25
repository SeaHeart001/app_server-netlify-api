const {connect, getJwtSecret} = require('../../db');
const {getHeader, response} = require('../../utils');
const {completeDeliveryAttempt} = require('../../utils/messages');

function getRequestBody(event) {
    if (!event || !event.body) {
        return {};
    }

    const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
    return JSON.parse(raw);
}

function getExpectedSecret() {
    return process.env.SSE_PUBLISH_SECRET || getJwtSecret();
}

exports.handler = async function handler(event, context) {
    if (context) {
        context.callbackWaitsForEmptyEventLoop = false;
    }

    if (event.httpMethod !== 'POST') {
        return response(405, {message: '请求方法不支持'});
    }

    if (getHeader(event, 'x-message-delivery-secret') !== getExpectedSecret()) {
        return response(401, {message: '无权执行消息投递任务'});
    }

    try {
        const body = getRequestBody(event);
        await connect();
        const result = await completeDeliveryAttempt(body.messageId);
        console.info('Message delivery fallback completed', {
            messageId: String(body.messageId || ''),
            ...result
        });
        return response(200, result);
    } catch (err) {
        console.error('Message delivery fallback failed', err);
        throw err;
    }
};
