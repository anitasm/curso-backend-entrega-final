const { ORDER_STATUS: S } = require('../constants');
module.exports = Object.freeze({ MAX_ORDER_ITEMS: 100, TRANSITIONS: Object.freeze({
  [S.CREATED]: [S.ASSIGNED, S.CANCELLED], [S.ASSIGNED]: [S.PICKED_UP, S.CANCELLED],
  [S.PICKED_UP]: [S.IN_TRANSIT], [S.IN_TRANSIT]: [S.DELIVERED], [S.DELIVERED]: [], [S.CANCELLED]: [],
}) });
