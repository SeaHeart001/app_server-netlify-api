// 埋点事件类型，所有埋点声明和报告配置统一引用这里，不写死字符串
const ANALYTICS_TYPES = {
    ACTIVITY_QUERY: 'activity.query',
    RELATION_MESSAGE: 'relation.message',
    ACTION_ACCEPTED: 'action.accepted'
};

// 活跃信号：业务路径 → type 映射
// 中间件会把运行时请求路径归一化为业务路径后再匹配（去掉 Netlify 的
// /.netlify/functions/<fn>/ 前缀），命中后自动注入 _analytics，无需业务代码感知
const ACTIVITY_SIGNALS = {
    '/users/me': ANALYTICS_TYPES.ACTIVITY_QUERY,
    '/users/relation': ANALYTICS_TYPES.ACTIVITY_QUERY,
    '/users/accounts': ANALYTICS_TYPES.ACTIVITY_QUERY,
    '/messages/events': ANALYTICS_TYPES.ACTIVITY_QUERY
};

module.exports = {ANALYTICS_TYPES, ACTIVITY_SIGNALS};
