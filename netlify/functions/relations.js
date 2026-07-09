const {createHandler} = require('../../utils');
const {router, routes} = require('../../services/relations');

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
