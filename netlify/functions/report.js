const {createHandler} = require('../../utils');
const {router, routes} = require('../../services/report');

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
