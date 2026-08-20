const jwt = require('jsonwebtoken');
const {connect} = require('../db');
const {AnalyticsEvent} = require('../db/model/analyticsEventModel');

function getUserIdFromToken(event) {
    try {
        const headers = event.headers || {};
        const headerKey = Object.keys(headers).find(key => key.toLowerCase() === 'authorization');
        const raw = headerKey ? String(headers[headerKey]).split(' ').pop() : '';

        if (!raw) {
            return null;
        }

        const decoded = jwt.decode(raw);
        if (!decoded || !decoded.id) {
            return null;
        }

        return decoded.id;
    } catch (err) {
        return null;
    }
}

async function trackEvent(userId, type, properties = {}) {
    try {
        await connect();
        const now = new Date();
        await AnalyticsEvent.create({
            userId,
            type,
            year: now.getFullYear(),
            properties,
            createdAt: now
        });
    } catch (err) {
        console.error('analytics track failed:', err.message);
    }
}

// 统一追踪入口：处理 result._analytics 数组
function trackFromEvent(analyticsEntries) {
    for (const entry of analyticsEntries) {
        if (entry.userId && entry.type) {
            trackEvent(entry.userId, entry.type, entry.properties || {});
        }
    }
}

module.exports = {
    getUserIdFromToken,
    trackEvent,
    trackFromEvent
};
