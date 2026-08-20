const {router} = require('../services/report');
const {createServiceRouter} = require('../utils/express');

module.exports = createServiceRouter(router);
