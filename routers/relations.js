const {router} = require('../services/relations');
const {createServiceRouter} = require('../utils/express');

module.exports = createServiceRouter(router);
