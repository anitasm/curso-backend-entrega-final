const { MOCK_DATABASE_NAME } = require('../config/mocks.config');
const definitions = {
  "INVALID_DELIVERY_STATUS": [400, "Estado de entrega inválido"],
  "DELIVERY_NOT_FOUND": [404, "Entrega no encontrada"],
  "ROUTE_NOT_FOUND": [
    404,
    "Ruta no encontrada"
  ],
  "INVALID_JSON": [
    400,
    "JSON inválido"
  ],
  "PAYLOAD_TOO_LARGE": [
    413,
    "El cuerpo de la petición supera el límite permitido"
  ],
  "INVALID_ID": [
    400,
    "ID inválido"
  ],
  "VALIDATION_ERROR": [
    400,
    "Datos incompatibles con el esquema"
  ],
  "USER_NOT_FOUND": [
    404,
    "Usuario no encontrado"
  ],
  "PRODUCT_NOT_FOUND": [
    404,
    "Producto no encontrado"
  ],
  "CART_NOT_FOUND": [
    404,
    "Carrito no encontrado"
  ],
  "CART_ITEM_NOT_FOUND": [
    404,
    "Producto en el carrito no encontrado"
  ],
  "ORDER_NOT_FOUND": [
    404,
    "Pedido no encontrado"
  ],
  "INVALID_ORDER_STATUS": [
    400,
    "Estado de pedido inválido"
  ],
  "USER_ALREADY_EXISTS": [
    409,
    "Ya existe un usuario con ese email"
  ],
  "DUPLICATE_CODE": [
    409,
    "Ya existe un producto con ese código"
  ],
  "DUPLICATE_KEY": [
    409,
    "Ya existe un registro con ese valor único"
  ],
  "INVALID_MOCK_AMOUNT": [
    400,
    "Cantidad de mocks inválida"
  ],
  "INVALID_MOCK_DATA": [
    400,
    "Datos de mocks inválidos"
  ],
  "MOCK_DATABASE_FORBIDDEN": [
    403,
    `Los mocks solo pueden escribirse en la base ${MOCK_DATABASE_NAME}`
  ],
  "MOCK_TRANSACTIONS_REQUIRED": [
    503,
    "Los mocks requieren transacciones de MongoDB: usá Atlas o un replica set; no se admite un servidor standalone"
  ],
  "MOCK_GENERATION_ERROR": [
    500,
    "No se pudo completar la generación de mocks"
  ],
  "DATABASE_ERROR": [
    500,
    "No se pudo completar la operación de persistencia"
  ],
  "INTERNAL_SERVER_ERROR": [
    500,
    "Error interno del servidor"
  ],
  "UPLOAD_ERROR": [
    400,
    "No se pudo subir la imagen (máximo 2 MB, campo image)"
  ]
};
module.exports = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([code, [status, message]]) => [code, Object.freeze({ code, status, message })])));
