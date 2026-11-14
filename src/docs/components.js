const dictionary = require('../errors/error-dictionary');
const { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, DELIVERY_PRIORITY } = require('../constants');
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const array = name => ({ type: 'array', items: ref(name) });
const object = (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...extra });
const text = { type: 'string', minLength: 1 };
const id = { type: 'string', pattern: '^[a-fA-F0-9]{24}$', example: '000000000000000000000001' };
const date = { type: 'string', format: 'date-time' };
const count = { type: 'integer', minimum: 0, maximum: 100, default: 0 };
const userInput = { firstName: text, lastName: text, email: { type: 'string', format: 'email' } };
const schemas = {
  Id: id,
  Success: object({ status: { type: 'string', enum: ['success'] } }),
  ErrorResponse: object({ status: { type: 'string', enum: ['error'] }, error: { type: 'string', enum: Object.keys(dictionary) }, message: { type: 'string' } }, undefined, { additionalProperties: false }),
  Persistence: object({ _id: ref('Id'), id: ref('Id'), createdAt: date, updatedAt: date }),
  UserFields: object({ ...userInput, role: { type: 'string', enum: Object.values(USER_ROLES) } }),
  UserCreate: object(userInput, undefined, { additionalProperties: false, example: { firstName: 'Alex', lastName: 'Ejemplo', email: 'alex@example.test' } }),
  UserUpdate: object(userInput, [], { additionalProperties: false, minProperties: 1, example: { firstName: 'Luz' } }),
  User: { allOf: [ref('UserFields'), ref('Persistence')] },
  MockUser: { allOf: [ref('UserFields'), object({ role: { type: 'string', enum: ['user', 'driver'] } })], description: 'Perfil simulado sin id, _id ni timestamps.' },
  MockDriver: { allOf: [ref('MockUser'), object({ role: { type: 'string', enum: ['driver'] } })] },
  LocalizedUser: object({ nombre: text, email: { type: 'string', format: 'email' }, rol: { type: 'string', enum: ['cliente', 'repartidor'] } }),
  OrderItem: object({ name: text, quantity: { type: 'integer', minimum: 1 }, price: { type: 'number', minimum: 0 } }),
  OrderFields: object({ customer: ref('Id'), items: { ...array('OrderItem'), minItems: 1 }, deliveryAddress: text, total: { type: 'number', minimum: 0, description: 'Suma de quantity × price de los items.' }, status: { type: 'string', enum: Object.values(ORDER_STATUS) }, priority: { type: 'string', enum: Object.values(DELIVERY_PRIORITY) } }),
  Order: { allOf: [ref('OrderFields'), ref('Persistence')] },
  MockOrder: { allOf: [ref('OrderFields')], description: 'Vista previa sin campos de persistencia; customer es una referencia simulada.' },
  DeliveryFields: object({ order: ref('Id'), driver: ref('Id'), status: { type: 'string', enum: Object.values(DELIVERY_STATUS) } }, ['order', 'status']),
  Delivery: { allOf: [ref('DeliveryFields'), ref('Persistence')], description: 'Referencias por ID, sin perfiles populados. driver puede omitirse cuando status es pending.' },
  MockDelivery: { allOf: [ref('DeliveryFields')], description: 'Vista previa pending sin driver, id, _id ni timestamps; order es simulado.' },
  Pagination: object({ totalPages: { type: 'integer', minimum: 1 }, page: { type: 'integer', minimum: 1 }, hasPrevPage: { type: 'boolean' }, hasNextPage: { type: 'boolean' }, prevPage: { type: 'integer', minimum: 1, nullable: true }, nextPage: { type: 'integer', minimum: 1, nullable: true }, prevLink: { type: 'string', nullable: true, description: 'Enlace relativo o null.' }, nextLink: { type: 'string', nullable: true, description: 'Enlace relativo o null.' } }),
  BatchInput: object({ users: count, drivers: count, orders: count, deliveries: count }, [], { additionalProperties: false, description: 'Solo estos campos; omisiones valen cero. Suma entre 1 y 100. orders > 0 requiere users > 0; deliveries <= orders.', example: { users: 1, drivers: 1, orders: 1, deliveries: 1 } }),
  BatchCounts: object({ users: count, drivers: count, orders: count, deliveries: count }),
  SeedResult: object({ insertados: { type: 'integer', minimum: 1, maximum: 100 }, coleccion: { type: 'string', enum: ['usuarios'] } }),
  SeedUsersPayload: object({ inserted: { type: 'integer', minimum: 1, maximum: 100 }, users: array('User'), collection: { type: 'string', enum: ['users'] } }),
  BatchPayload: object({ insertados: ref('BatchCounts') }),
  LoggerResult: object({ status: { type: 'string', enum: ['success'] }, message: { type: 'string', enum: ['Logs de diagnóstico generados'] } }),
  HealthResult: object({ status: { type: 'string', enum: ['ok'] }, timestamp: date }),
};
for (const name of ['User', 'Order', 'Delivery']) {
  schemas[`${name}Result`] = { allOf: [ref('Success'), object({ payload: ref(name) })] };
  schemas[`${name}Page`] = { allOf: [ref('Success'), object({ payload: array(name) }), ref('Pagination')] };
}
for (const name of ['MockUser', 'MockDriver', 'MockOrder', 'MockDelivery']) {
  schemas[`${name}List`] = { allOf: [ref('Success'), object({ payload: array(name) })] };
}
for (const name of ['SeedUsers', 'Batch']) schemas[`${name}Result`] = { allOf: [ref('Success'), object({ payload: ref(`${name}Payload`) })] };
const headers = { RequestId: { description: 'UUID v4 generado por el servidor para correlacionar los logs; no se recibe como parámetro.', schema: { type: 'string', format: 'uuid' } } };
const responseHeaders = { 'X-Request-Id': { $ref: '#/components/headers/RequestId' } };
const responses = {};
function errors(name, codes, exampleMessages = {}) {
  const entries = codes.map(code => dictionary[code]);
  if (new Set(entries.map(e => e.status)).size !== 1) throw new Error('Respuesta documental con estados incompatibles');
  responses[name] = { description: entries.map(e => `${e.code}: ${e.message}`).join('. ') + '. Las validaciones pueden dar mensajes públicos contextuales.', headers: responseHeaders, content: { 'application/json': { schema: ref('ErrorResponse'), examples: Object.fromEntries(entries.map(e => [e.code, { value: { status: 'error', error: e.code, message: exampleMessages[e.code] || e.message } }])) } } };
}
errors('PaginationError', ['VALIDATION_ERROR'], { VALIDATION_ERROR: 'limit no puede superar 100' });
errors('InvalidId', ['INVALID_ID']);
errors('UserInputError', ['VALIDATION_ERROR', 'INVALID_JSON'], { VALIDATION_ERROR: 'firstName debe ser texto no vacío' });
errors('UserUpdateError', ['INVALID_ID', 'VALIDATION_ERROR', 'INVALID_JSON'], { VALIDATION_ERROR: 'Actualización vacía' });
errors('OrderFilterError', ['INVALID_ORDER_STATUS', 'VALIDATION_ERROR']);
errors('DeliveryFilterError', ['INVALID_DELIVERY_STATUS', 'VALIDATION_ERROR']);
errors('MockQueryError', ['INVALID_MOCK_AMOUNT', 'INVALID_MOCK_DATA'], { INVALID_MOCK_AMOUNT: 'qty debe ser un entero decimal entre 1 y 100', INVALID_MOCK_DATA: 'Campo no permitido' });
errors('MockWriteQueryError', ['INVALID_MOCK_AMOUNT', 'INVALID_MOCK_DATA', 'INVALID_JSON', 'VALIDATION_ERROR'], { INVALID_MOCK_AMOUNT: 'qty debe ser un entero decimal entre 1 y 100', INVALID_MOCK_DATA: 'Campo no permitido' });
errors('MockInputError', ['INVALID_MOCK_AMOUNT', 'INVALID_MOCK_DATA', 'INVALID_JSON', 'VALIDATION_ERROR'], { INVALID_MOCK_AMOUNT: 'El lote debe contener entre 1 y 100 registros en total', INVALID_MOCK_DATA: 'Para generar pedidos se requiere al menos un cliente (users)' });
errors('MockConflict', ['USER_ALREADY_EXISTS', 'DUPLICATE_KEY']);
for (const code of ['USER_NOT_FOUND', 'ORDER_NOT_FOUND', 'DELIVERY_NOT_FOUND', 'USER_ALREADY_EXISTS', 'DATABASE_ERROR', 'ROUTE_NOT_FOUND', 'MOCK_DATABASE_FORBIDDEN', 'MOCK_GENERATION_ERROR', 'MOCK_TRANSACTIONS_REQUIRED', 'PAYLOAD_TOO_LARGE']) errors(code, [code]);
const parameters = {
  Page: { name: 'page', in: 'query', description: 'Página solicitada. No se aceptan parámetros repetidos.', schema: { type: 'integer', minimum: 1, default: 1 } },
  Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
  Qty: { name: 'qty', in: 'query', description: 'Entero decimal de 1 a 100, sin fracciones, signo ni parámetros repetidos.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
  SeedQty: { name: 'qty', in: 'query', required: true, description: 'Entero decimal obligatorio de 1 a 100; sin valor predeterminado.', schema: { type: 'integer', minimum: 1, maximum: 100 } },
};
for (const [key, name] of [['UserId', 'uid'], ['OrderId', 'oid'], ['DeliveryId', 'did']]) parameters[key] = { name, in: 'path', required: true, schema: ref('Id') };
parameters.OrderStatus = { name: 'status', in: 'query', schema: { type: 'string', enum: Object.values(ORDER_STATUS) } };
parameters.DeliveryStatus = { name: 'status', in: 'query', schema: { type: 'string', enum: Object.values(DELIVERY_STATUS) } };
module.exports = { schemas, parameters, responses, headers };
