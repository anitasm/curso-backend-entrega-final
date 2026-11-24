const { MOCK_DATABASE_NAME } = require('../config/mocks.config');
const definitions = {
  ORDER_NOT_EDITABLE: [409, 'Solo se puede editar un pedido en estado created'],
  ORDER_NOT_DELETABLE: [409, 'Solo se puede dar de baja un pedido created sin entrega'],
  INVALID_ORDER_TRANSITION: [409, 'Transición de pedido incompatible con el estado actual'],
  ORDER_CONCURRENT_MODIFICATION: [409, 'El pedido cambió durante la operación; volver a consultar'],
  DELIVERY_ALREADY_EXISTS: [409, 'Ya existe una entrega para el pedido'],
  INVALID_DELIVERY_ASSIGNMENT: [409, 'La entrega no admite esta asignación'],
  INVALID_DRIVER_ROLE: [400, 'El perfil debe tener rol driver'],
  USER_IN_USE: [409, 'El perfil está referenciado por pedidos o entregas'],
  TRANSACTIONS_REQUIRED: [503, 'Esta operación requiere un replica set de MongoDB'],
  FILE_REQUIRED: [400, 'Se requiere un archivo'],
  INVALID_UPLOAD_FIELD: [400, 'Campos o cantidad de archivos no permitidos'],
  INVALID_MULTIPART: [400, 'Formulario multipart inválido'],
  INVALID_DOCUMENT_TYPE: [400, 'Tipo de documento inválido o incompatible con el perfil'],
  FILE_TOO_LARGE: [413, 'El archivo supera el máximo de 5 MiB'],
  INVALID_FILE_TYPE: [415, 'Formato de archivo no permitido o contenido incompatible'],
  FILE_SAVE_ERROR: [500, 'No se pudo guardar el archivo'],
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
