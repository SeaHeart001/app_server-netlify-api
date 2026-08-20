const {AnalyticsEvent} = require('../db/model/analyticsEventModel');
const {getCurrentUser} = require('../utils/auth');
const {getUserId} = require('../utils/relations');
const {STATS_TEMPLATES, EVENT_TEMPLATES} = require('../utils/reportConfig');

// ─── 工具函数 ───
// 时间统一按北京时间输出，sv-SE locale 固定输出 YYYY-MM-DD / HH:mm:ss 格式
const TIME_ZONE_OPTIONS = {timeZone: 'Asia/Shanghai'};
const formatDate = d => (d ? new Date(d).toLocaleDateString('sv-SE', TIME_ZONE_OPTIONS) : '');
const formatTime = d => (d ? new Date(d).toLocaleTimeString('sv-SE', TIME_ZONE_OPTIONS).slice(0, 5) : '');

// 求某个北京日期 00:00 对应的 UTC 时刻
function beijingMidnight(year, monthIndex, day) {
    const guess = Date.UTC(year, monthIndex, day);
    const guessDate = new Date(guess);
    const dateStr = guessDate.toLocaleDateString('sv-SE', TIME_ZONE_OPTIONS);
    const timeStr = guessDate.toLocaleTimeString('sv-SE', TIME_ZONE_OPTIONS);
    const wallAsUtc = Date.UTC(
        Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
        Number(timeStr.slice(0, 2)), Number(timeStr.slice(3, 5))
    );
    return new Date(guess - (wallAsUtc - guess));
}
const fill = (tpl, data) => {
    const matches = tpl.match(/\{(\w+)\}/g);
    if (matches) {
        for (const match of matches) {
            const key = match.slice(1, -1);
            if (!data[key]) return null;
        }
    }
    return tpl.replace(/\{(\w+)\}/g, (_, k) => data[k]);
};

// ─── 统计指标（内置计算，无需配置查询） ───
async function computeStats(userId, start, end) {
    const events = await AnalyticsEvent.find({
        userId, createdAt: {$gte: start, $lt: end}
    }).select('createdAt').lean();

    if (!events.length) {
        return {activeDays: 0, latestTime: '', topMonth: '', streak: 0};
    }

    // 活跃天数
    const days = [...new Set(events.map(e => formatDate(e.createdAt)))];
    const activeDays = days.length;

    // 最晚活跃（以凌晨5点为日切分点）
    // 一天定义为 05:00 到次日 05:00
    const getDayKey = date => {
        const d = new Date(date);
        const hours = Number(d.toLocaleTimeString('sv-SE', TIME_ZONE_OPTIONS).slice(0, 2));
        if (hours >= 5) return formatDate(d);
        // 凌晨 5 点前算前一天
        return formatDate(new Date(d.getTime() - 864e5));
    };

    // 按“日”分组，找每天最晚活动
    const latestByDay = {};
    events.forEach(e => {
        const dayKey = getDayKey(e.createdAt);
        if (!latestByDay[dayKey] || latestByDay[dayKey].createdAt < e.createdAt) {
            latestByDay[dayKey] = e;
        }
    });

    // 找“最晚”的那天（距离5点最近）
    const getTimeScore = date => {
        const timeStr = new Date(date).toLocaleTimeString('sv-SE', TIME_ZONE_OPTIONS);
        const h = Number(timeStr.slice(0, 2)), m = Number(timeStr.slice(3, 5));
        return h >= 5 ? (h - 5) * 60 + m : (h + 19) * 60 + m;
    };

    let latestDate = '', latestTime = '';
    if (Object.keys(latestByDay).length > 0) {
        const latest = Object.values(latestByDay).reduce((a, b) =>
            getTimeScore(a.createdAt) > getTimeScore(b.createdAt) ? a : b
        );
        latestDate = formatDate(latest.createdAt);
        latestTime = formatTime(latest.createdAt);
    }

    // 最活跃的一天（按事件数量）
    const eventCountByDay = {};
    events.forEach(e => {
        const dayKey = formatDate(e.createdAt);
        eventCountByDay[dayKey] = (eventCountByDay[dayKey] || 0) + 1;
    });
    const topDay = Object.entries(eventCountByDay).sort((a, b) => b[1] - a[1])[0];

    // 连续活跃
    days.sort();
    let streak = 1, cur = 1;
    for (let i = 1; i < days.length; i++) {
        const diff = (new Date(days[i]) - new Date(days[i - 1])) / 864e5;
        cur = diff === 1 ? cur + 1 : 1;
        streak = Math.max(streak, cur);
    }

    return {
        activeDays,
        latestDate,
        latestTime,
        topDay: topDay ? `${topDay[0]}（${topDay[1]}次）` : '',
        streak
    };
}

// ─── 事件列表查询 ───
async function queryEvents(item, userId, start, end) {
    const match = {userId, type: item.type, createdAt: {$gte: start, $lt: end}};

    if (item.filter) {
        Object.entries(item.filter).forEach(([key, value]) => {
            match[`properties.${key}`] = value;
        });
    }

    // count 模式：只统计条数，文案用配置里该项的 template
    if (item.mode === 'count') {
        const count = await AnalyticsEvent.countDocuments(match);
        return count ? [{count}] : [];
    }

    // 默认模式：逐条列出
    const events = await AnalyticsEvent.find(match)
        .select('-_id createdAt properties')
        .sort({createdAt: 1})
        .lean();

    return events.map(e => ({
        date: formatDate(e.createdAt),
        datetime: formatDateTime(e.createdAt),
        ...e.properties
    }));
}

// ─── 生成报告 ───
async function generateReport({event}) {
    const user = await getCurrentUser(event);
    const userId = getUserId(user);
    const year = Number(new Date().toLocaleDateString('sv-SE', TIME_ZONE_OPTIONS).slice(0, 4));
    // 北京时间当年的起止时刻
    const start = beijingMidnight(year, 0, 1);
    const end = beijingMidnight(year + 1, 0, 1);

    const stats = await computeStats(userId, start, end);
    const lines = STATS_TEMPLATES
        .map(tpl => fill(tpl, {year, ...stats}))
        .filter(Boolean);

    for (const item of EVENT_TEMPLATES) {
        const data = await queryEvents(item, userId, start, end);
        data.forEach(d => {
            const line = fill(item.template, d);
            if (line) lines.push(line);
        });
    }

    return {year, lines};
}

const router = {report: generateReport};
const routes = Object.keys(router);

module.exports = {generateReport, router, routes, formatDate, formatTime, beijingMidnight};
