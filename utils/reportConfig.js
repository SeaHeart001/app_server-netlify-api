// 年度报告配置，修改文案只改这里，不需要动 services/report.js

const {ANALYTICS_TYPES} = require('./features/analyticsEvents');
const {ACTION_KINDS} = require('./messages');

// ─── 统计行配置 ───
// 每条都是独立模板，变量来自 computeStats 的内置计算结果，另有 {year}
// 缺变量的行会自动跳过
const STATS_TEMPLATES = [
    '{year} 年，你活跃了 {activeDays} 天',
    '你 {latestDate} 那天{latestTime} 还在',
    '你最活跃的一天是 {topDay}',
    '最长连续活跃 {streak} 天'
];

// ─── 事件行配置 ───
// 每项独立配置，互不影响：
// - type：查询的事件类型
// - filter：可选，对 properties 字段追加过滤条件
// - mode: 'count'：只统计条数，模板可用 {count}
// - 默认逐条列出，properties 自动展开为模板变量，另有 {date}、{datetime}
// 消息类统计：一个消息类型写一条，新增消息类型时在这里加一条即可
const EVENT_TEMPLATES = [
    {
        type: ANALYTICS_TYPES.ACTION_ACCEPTED,
        filter: {actionKind: ACTION_KINDS.RELATION_BIND},
        template: '{date} 与 {targetUserId} 绑定成功'
    },
    {
        type: ANALYTICS_TYPES.RELATION_MESSAGE,
        filter: {messageType: 'pat'},
        mode: 'count',
        template: '你拍一拍了 {count} 次'
    }
];

module.exports = {STATS_TEMPLATES, EVENT_TEMPLATES};
