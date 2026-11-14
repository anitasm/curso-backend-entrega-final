# ShipNow / Rina

Aplicación de catálogo y carritos para accesorios, con Rina como tienda de ejemplo. Incluye perfiles de usuarios, generación de datos ficticios relacionados y consultas de pedidos. No realiza envíos ni pagos reales.

Utiliza CommonJS, Express 4, Mongoose 9, Handlebars, Socket.io y Multer. Los generadores usan `node:crypto`; las pruebas usan `node:test`.

## Instalación y ejecución

Requiere Node.js 22.22.2 o superior (según las dependencias instaladas), npm y una conexión MongoDB. Las escrituras de mocks necesitan Atlas o un replica set con soporte de transacciones.

Desde la raíz del proyecto, en PowerShell:

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Copiar la plantilla solo si todavía no existe `.env`. Completar sus variables localmente:

| Variable | Configuración |
| --- | --- |
| `PORT` | Puerto entero entre 1 y 65535; la plantilla usa `8080` |
| `NODE_ENV` | `development`, `test` o `production`; la plantilla usa `development` |
| `MONGODB_URI` | URI `mongodb://` o `mongodb+srv://`; obligatoria y sin valor en la plantilla |

Las tres variables son obligatorias. Para las cargas ficticias, la URI debe seleccionar la base `shipnow_mock_dev`. Conservar las credenciales en `.env`, que está ignorado por Git. En Atlas, autorizar la IP de conexión y usar un usuario de base con los permisos necesarios.

```powershell
npm.cmd run dev
```

El catálogo queda disponible en `http://localhost:8080/products` con el puerto de la plantilla. `npm.cmd start` inicia sin nodemon. Los cambios en `.env` requieren reiniciar el proceso. La base dedicada puede tener el catálogo vacío: los mocks no crean productos.

## Arquitectura

```text
Router → Controller → Service → Repository → Model / MongoDB
                         ↓
                    Generadores
```

- `src/app.js`: fábrica Express con servicios inyectados, sin cargar modelos, conectar ni escuchar al importarse.
- `src/server.js`: configuración, conexión, composición de servicios y arranque de HTTP y Socket.io.
- `src/services`: validaciones de dominio y coordinación de operaciones.
- `src/repositories`: consultas, proyecciones y traducción de fallos de persistencia.
- `src/mocks`: generación de perfiles, pedidos y entregas ficticios.
- `src/errors`: clase `AppError` y diccionario de códigos, estados HTTP y mensajes públicos.
- `src/middlewares/errors.js`: único emisor JSON de errores HTTP.

Los controllers propagan errores mediante `next(error)`. El orden de Express es parsers y rutas → ruta desconocida → middleware global de cuatro parámetros. Si ya se enviaron cabeceras, el middleware deriva el error a `next`.

## API y vistas

Las respuestas de éxito de las API usan `status: "success"` y `payload`, salvo las variantes de mocks y health indicadas abajo. Los listados paginados incluyen página, enlaces y total de páginas.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health` | Disponibilidad HTTP: `status: "ok"` y `timestamp`; no consulta MongoDB |
| GET / POST | `/api/products` | Listar / crear productos |
| GET / PUT / DELETE | `/api/products/:pid` | Consultar / actualizar / eliminar producto |
| GET / POST | `/api/users` | Listar / crear perfiles |
| GET / PUT / DELETE | `/api/users/:uid` | Consultar / actualizar / eliminar perfil |
| POST | `/api/carts` | Crear carrito |
| GET / PUT / DELETE | `/api/carts/:cid` | Consultar / reemplazar productos / vaciar carrito |
| POST | `/api/carts/:cid/product/:pid` | Agregar producto |
| PUT / DELETE | `/api/carts/:cid/products/:pid` | Cambiar cantidad / quitar producto |
| GET | `/api/orders/:oid` | Consultar un pedido persistido |
| GET | `/api/orders` | Listar pedidos, con `status`, `page` y `limit` opcionales |

Productos, usuarios y pedidos admiten `page` y `limit`: valores predeterminados 1 y 10, máximo 100 por página. Productos admite además `sort=asc|desc` por precio y `query` por categoría o disponibilidad (`true|false`). Pedidos usa orden estable por fecha descendente e identificador ascendente. Rechaza filtros desconocidos; `status` debe ser `created`, `assigned`, `picked_up`, `in_transit`, `delivered` o `cancelled`.

Los perfiles contienen `firstName`, `lastName`, `email` y `role`, sin contraseña. El alta pública asigna `user` y no permite escribir `role`. Productos acepta una imagen en el campo multipart `image`, hasta 2 MB; una creación fallida limpia el archivo subido. Las notificaciones Socket.io no revierten una escritura ya confirmada.

Vistas: `/` redirige a `/products`; también están disponibles `/products/:pid`, `/realtimeproducts` y `/carts/:cid`. Se conservan sus imágenes y eventos de actualización del catálogo.

## Generación de datos ficticios

Las rutas `/api/mocks` se montan únicamente en `development` y `test`. En `production` responden 404 `ROUTE_NOT_FOUND`.

| Método | Ruta bajo `/api/mocks` | Resultado |
| --- | --- | --- |
| GET | `/users?qty=2` | 200, arreglo con `nombre`, `email`, `rol` (`cliente` / `repartidor`) |
| GET | `/mockingusers?qty=2` | 200, `status/payload` con campos del modelo y roles `user` / `driver` |
| GET | `/mockingdrivers?qty=1` | 200, perfiles `driver` |
| GET | `/mockingorders?qty=2` | 200, pedidos simulados |
| GET | `/mockingdeliveries?qty=2` | 200, entregas simuladas |
| POST | `/users?qty=2` | 201, `status/payload` con `inserted`, `users` y `collection` |
| POST | `/seed?qty=10` | 201, `{"insertados":10,"coleccion":"usuarios"}` |
| POST | `/generateData` | 201, `status/payload/insertados` con conteos por entidad |

`qty` admite enteros decimales entre 1 y 100; por defecto vale 10, excepto en `/seed`, donde es obligatorio. Los parámetros repetidos o mal formados se rechazan. Los GET generan en memoria: no escriben ni consultan repositorios y sus referencias hexadecimales son simuladas.

Para guardar un lote relacionado, usar POST `/api/mocks/generateData`, con Body → raw → JSON:

```json
{ "users": 2, "drivers": 1, "orders": 2, "deliveries": 2 }
```

Solo se aceptan esos cuatro campos, como enteros numéricos entre 0 y 100; los omitidos valen cero. El lote debe sumar entre 1 y 100 documentos. Los pedidos requieren al menos un cliente (`users`); las entregas no pueden superar los pedidos. Sin repartidor, la entrega queda `pending` y el pedido `created`; con repartidor, ambos quedan `assigned`.

Cada POST exitoso agrega un lote nuevo. Las escrituras usan una sesión y transacción compartidas: perfiles → pedidos → entregas. Las referencias provienen de los documentos insertados en esa misma operación. Las excepciones originales permanecen dentro del callback para permitir los reintentos del driver; se traducen después de finalizar la transacción. No existe una alternativa de escritura parcial para servidores standalone.

Los POST verifican el nombre real de la base de la conexión activa y solo escriben en `shipnow_mock_dev`. Una base diferente produce 403; una conexión sin soporte de transacciones produce 503.

| Modelo | Colección | Relaciones |
| --- | --- | --- |
| User | `users` | Clientes `user` y repartidores `driver` |
| Order | `orders` | `customer` referencia un cliente existente |
| Delivery | `deliveries` | `order` referencia un pedido; `driver` opcional referencia un repartidor |
| Product / Cart | `products` / `carts` | Catálogo y carritos independientes de los mocks |

En Atlas se pueden verificar las relaciones buscando cada referencia por `_id` y comprobando el rol del perfil relacionado. `usuarios` es la etiqueta de respuesta de `/seed`; la colección real es `users`.

## Errores HTTP

El diccionario [error-dictionary.js](src/errors/error-dictionary.js) es la fuente única de códigos, estados HTTP numéricos y mensajes públicos; tanto sus entradas como el diccionario están congelados. `AppError` recibe una clave y puede conservar una causa privada. Las validaciones permiten mensajes contextuales definidos por el código, sin reflejar valores recibidos.

```json
{
  "status": "error",
  "error": "ORDER_NOT_FOUND",
  "message": "Pedido no encontrado"
}
```

El estado HTTP viaja en la respuesta, no en un campo `statusCode` del JSON. Los mensajes 5xx siempre provienen del diccionario. No se exponen stack, causa, body, credenciales ni errores crudos de MongoDB. Los errores desconocidos se convierten en 500 `INTERNAL_SERVER_ERROR`; sus propiedades arbitrarias no determinan el estado HTTP. Los registros de acceso omiten URL, query y body.

| HTTP | Códigos |
| --- | --- |
| 400 | `INVALID_JSON`, `INVALID_ID`, `VALIDATION_ERROR`, `INVALID_ORDER_STATUS`, `INVALID_MOCK_AMOUNT`, `INVALID_MOCK_DATA`, `UPLOAD_ERROR` |
| 403 | `MOCK_DATABASE_FORBIDDEN` |
| 404 | `ROUTE_NOT_FOUND`, `USER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CART_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND` |
| 409 | `USER_ALREADY_EXISTS`, `DUPLICATE_CODE`, `DUPLICATE_KEY` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 500 | `DATABASE_ERROR`, `MOCK_GENERATION_ERROR`, `INTERNAL_SERVER_ERROR` |
| 503 | `MOCK_TRANSACTIONS_REQUIRED` |

La persistencia distingue duplicados por entidad y campo. `DUPLICATE_CODE` conserva los reintentos de generación de códigos de producto. Los errores de esquema y conversión son 400; los de infraestructura son 500. Un fallo inesperado definitivo de carga ficticia produce `MOCK_GENERATION_ERROR`. Los eventos de Socket.io y los fallos de arranque usan sus mecanismos propios, fuera de este contrato HTTP.

## Pruebas en Postman

Importar la colección [Errores HTTP](postman/ShipNow-Errores.postman_collection.json). La colección define `baseUrl=http://localhost:8080`, por lo que no requiere importar un entorno. La [colección de mocks](postman/ShipNow-Modulo-2.postman_collection.json) mantiene las consultas y cargas exitosas. Tras enviar una petición, abrir **Test Results** en el panel de respuesta.

| Método | Ruta | Datos o condición | HTTP | Error esperado |
| --- | --- | --- | --- | --- |
| GET | `/api/no-existe` | — | 404 | `ROUTE_NOT_FOUND` |
| GET | `/api/users/no-es-id` | — | 400 | `INVALID_ID` |
| GET | `/api/users/ffffffffffffffffffffffff` | ID válido inexistente | 404 | `USER_NOT_FOUND` |
| GET | `/api/orders/ffffffffffffffffffffffff` | ID válido inexistente | 404 | `ORDER_NOT_FOUND` |
| GET | `/api/orders?status=no-existe` | — | 400 | `INVALID_ORDER_STATUS` |
| GET | `/api/mocks/users?qty=-1` | — | 400 | `INVALID_MOCK_AMOUNT` |
| POST | `/api/mocks/generateData` | JSON malformado: `{"users":` | 400 | `INVALID_JSON` |
| POST | `/api/mocks/generateData` | `{"orders":1}` | 400 | `INVALID_MOCK_DATA` |
| POST | `/api/mocks/generateData` | JSON superior a 100 KB | 413 | `PAYLOAD_TOO_LARGE` |
| POST | `/api/mocks/seed?qty=1` | Conexión a una base distinta de `shipnow_mock_dev` | 403 | `MOCK_DATABASE_FORBIDDEN` |

Los casos con mocks requieren `development` o `test`. Los IDs de ejemplo deben estar ausentes de la base. El caso 403 está en una carpeta separada: para probarlo, seleccionar localmente otra base en la URI y reiniciar; la petición debe bloquearse antes de insertar. Restaurar la base dedicada y reiniciar para las cargas exitosas. No ejecutar ese caso esperando 403 sobre la base dedicada: allí crearía un perfil.

## Pruebas automatizadas

```powershell
npm.cmd test
```

La suite usa servidores efímeros y dobles de persistencia, sin conectar a Atlas. Comprueba catálogo, carritos, perfiles, uploads, Socket.io, pedidos, errores HTTP, mensajes seguros, límites y coordinación transaccional. Los fallos de base se simulan con dobles; no es necesario desconectar una base real.

La comprobación real de rollback es independiente:

```powershell
node --test test/integration/mocks-transaction.js
```

Requiere la URI local configurada para `shipnow_mock_dev`, entorno distinto de producción y Atlas o un replica set. Verifica la base activa antes de cargar modelos, intenta insertar un lote dentro de una transacción, provoca un fallo y comprueba que esos documentos no queden persistidos. No borra documentos anteriores. Los dobles de la suite ordinaria comprueban coordinación y propagación, no la atomicidad del servidor MongoDB.