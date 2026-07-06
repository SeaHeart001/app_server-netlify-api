const {createHandler} = require('../utils');
const {router, routes} = require('../../services/users');

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
