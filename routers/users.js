const {router} = require('../services/users');
const {createServiceRouter} = require('./utils');

module.exports = createServiceRouter(router);
