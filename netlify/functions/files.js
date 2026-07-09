const {createHandler} = require('../../utils');
const {router, routes} = require('../../services/files');

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
