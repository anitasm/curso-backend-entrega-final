const { USER_ROLES } = require('../constants');
const roleLabels = Object.freeze({ [USER_ROLES.USER]: 'cliente', [USER_ROLES.DRIVER]: 'repartidor' });

const presentUser = user => ({
  nombre: `${user.firstName} ${user.lastName}`,
  email: user.email,
  rol: roleLabels[user.role],
});

module.exports = { presentUser };
