const { randomUUID } = require('node:crypto');
const { USER_ROLES } = require('../constants');

const firstNames = ['Alex', 'Luz', 'Sol', 'Nico'];
const lastNames = ['Ejemplo', 'Prueba', 'Demo'];

function generateUsers(quantity, role) {
  return Array.from({ length: quantity }, (_, index) => ({
    firstName: firstNames[index % firstNames.length],
    lastName: lastNames[index % lastNames.length],
    email: `mock-${randomUUID()}@example.test`,
    role: role || (index % 2 === 0 ? USER_ROLES.USER : USER_ROLES.DRIVER),
  }));
}

module.exports = generateUsers;
