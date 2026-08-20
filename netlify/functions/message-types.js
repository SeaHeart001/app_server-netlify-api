const {createHandler} = require('../../utils');
const {router, routes} = require('../../services/message-types');

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
