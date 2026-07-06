const {createHandler} = require('../utils');
const {router, routes} = require('../../services/messages');

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
