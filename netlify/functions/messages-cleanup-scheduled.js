const {connect} = require('../../db');
const {response} = require('../../utils');
const {cleanupMessages} = require('../../services/messages');

exports.handler = async function handler(event, context) {
    if (context) {
        context.callbackWaitsForEmptyEventLoop = false;
    }

    try {
        await connect();
        const result = await cleanupMessages();
        console.info('Messages cleanup completed', result);
        return response(200, result);
    } catch (err) {
        console.error('Messages cleanup failed', err);
        return response(500, {
            message: '消息清理失败'
        });
    }
};
