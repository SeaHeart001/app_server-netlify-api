const {router} = require('../services/users');
const {createServiceRouter} = require('../utils/express');

module.exports = createServiceRouter(router);
