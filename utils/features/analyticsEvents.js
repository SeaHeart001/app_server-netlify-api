// 埋点事件类型，所有埋点声明和报告配置统一引用这里，不写死字符串
const ANALYTICS_TYPES = {
    ACTIVITY_QUERY: 'activity.query',
    RELATION_MESSAGE: 'relation.message',
    ACTION_ACCEPTED: 'action.accepted'
};

// 活跃信号：path → type 映射
// 中间件检测到这些 path 时，自动注入 _analytics
const ACTIVITY_SIGNALS = {
    '/users/me': ANALYTICS_TYPES.ACTIVITY_QUERY,
    '/users/relation': ANALYTICS_TYPES.ACTIVITY_QUERY,
    '/users/accounts': ANALYTICS_TYPES.ACTIVITY_QUERY,
    '/messages/events': ANALYTICS_TYPES.ACTIVITY_QUERY
};

module.exports = {ANALYTICS_TYPES, ACTIVITY_SIGNALS};
