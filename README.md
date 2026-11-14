# ShipNow / Rina

Aplicación de catálogo y carritos para accesorios, con Rina como tienda de ejemplo. Incluye perfiles de usuarios, generación de datos ficticios relacionados, alta y consultas de pedidos, consultas de entregas y asociación de documentos y comprobantes privados. No realiza envíos ni pagos reales.

Utiliza CommonJS, Express 4, Mongoose 9, Handlebars, Socket.io, Multer y Winston. Los generadores usan `node:crypto`; las regresiones usan `node:test` y la suite funcional utiliza Mocha, Chai y Supertest.

## Instalación y ejecución

Requiere Node.js 22.22.2 o superior (según las dependencias instaladas), npm y una conexión MongoDB. Las escrituras de mocks necesitan Atlas o un replica set con soporte de transacciones.

Desde la raíz del proyecto, en PowerShell:

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Completar las variables de `.env` localmente:

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

Swagger UI: [documentación interactiva](http://localhost:8080/api/docs/). Especificación: [OpenAPI JSON](http://localhost:8080/api/docs/openapi.json). Reemplazar `8080` por el `PORT` configurado. Swagger usa el mismo origen y puerto de la aplicación.

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
- `src/docs`: configuración OpenAPI 3.0.3, componentes reutilizables y fuentes YAML por módulo; Swagger UI carga el JSON servido por la aplicación.
- `src/mocks`: generación de perfiles, pedidos y entregas ficticios.
- `src/errors`: clase `AppError` y diccionario de códigos, estados HTTP y mensajes públicos.
- `src/middlewares/errors.js`: único emisor JSON de errores HTTP.
- `src/utils/logger.js`: fábrica de Winston y cierre de transportes.
- `src/utils/log-events.js`: eventos constantes y lista de metadatos permitidos.
- `src/utils/request-context.js`: contexto por petición con AsyncLocalStorage.

Los controllers propagan errores mediante `next(error)`. El orden de Express es contexto y logging HTTP → parsers y rutas → ruta desconocida → middleware global de cuatro parámetros. Si ya se enviaron cabeceras, un manejador final registra el fallo y cierra la respuesta parcial, sin intentar emitir otro JSON ni exponer la excepción.

## API y vistas

Las respuestas de éxito de las API usan `status: "success"` y `payload`, salvo las variantes de mocks y health indicadas abajo. Los listados paginados incluyen página, enlaces y total de páginas.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health` | Disponibilidad HTTP: `status: "ok"` y `timestamp`; no consulta MongoDB |
| GET / POST | `/api/products` | Listar / crear productos |
| GET / PUT / DELETE | `/api/products/:pid` | Consultar / actualizar / eliminar producto |
| GET / POST | `/api/users` | Listar / crear perfiles |
| GET / PUT / DELETE | `/api/users/:uid` | Consultar / actualizar / eliminar perfil |
| POST | `/api/users/:uid/documents` | Asociar un documento privado a un perfil |
| POST | `/api/deliveries/:did/proof` | Asociar un comprobante privado a una entrega |
| POST | `/api/carts` | Crear carrito |
| GET / PUT / DELETE | `/api/carts/:cid` | Consultar / reemplazar productos / vaciar carrito |
| POST | `/api/carts/:cid/product/:pid` | Agregar producto |
| PUT / DELETE | `/api/carts/:cid/products/:pid` | Cambiar cantidad / quitar producto |
| GET | `/api/orders/:oid` | Consultar un pedido persistido |
| GET | `/api/orders` | Listar pedidos, con `status`, `page` y `limit` opcionales |
| POST | `/api/orders` | Crear un pedido con cliente existente, total calculado y estado inicial `created` |
| GET | `/api/deliveries` | Listar entregas persistidas, con `status`, `page` y `limit` opcionales |
| GET | `/api/deliveries/:did` | Consultar una entrega persistida |

Productos, usuarios, pedidos y entregas admiten `page` y `limit`: valores predeterminados 1 y 10, máximo 100 por página. Productos admite además `sort=asc|desc` por precio y `query` por categoría o disponibilidad (`true|false`). Pedidos usa orden estable por fecha descendente e identificador ascendente. Rechaza filtros desconocidos; `status` debe ser `created`, `assigned`, `picked_up`, `in_transit`, `delivered` o `cancelled`.

Entregas acepta `status=pending|assigned`, rechaza filtros desconocidos y usa el mismo orden estable que pedidos. Devuelve `order`, `driver` cuando existe, `status`, `createdAt`, `updatedAt`, `_id` e `id`. Las referencias son IDs, sin perfiles populados. Una entrega pendiente puede omitir `driver`. Estas consultas son de lectura y funcionan fuera de la base dedicada a mocks. No se ofrecen operaciones para crear, cambiar el estado o eliminar entregas por esta API; la carga de comprobantes solo agrega metadatos.

Los perfiles contienen `firstName`, `lastName`, `email` y `role`, sin contraseña. El alta pública asigna `user` y no permite escribir `role`. Productos acepta una imagen en el campo multipart `image`, hasta 2 MB; una creación fallida limpia el archivo subido. Las notificaciones Socket.io no revierten una escritura ya confirmada.

Vistas: `/` redirige a `/products`; también están disponibles `/products/:pid`, `/realtimeproducts` y `/carts/:cid`. Se conservan sus imágenes y eventos de actualización del catálogo.

### Alta de pedidos

POST `/api/orders` acepta exclusivamente un cuerpo JSON con `customer`, `items` y `deliveryAddress`; `priority` es opcional (`low`, `normal` o `high`, por defecto `normal`). Ejemplo ficticio: el ID de cliente debe sustituirse por el de un perfil existente con rol `user`.

```json
{
  "customer": "000000000000000000000001",
  "items": [{ "name": "Aro ficticio", "quantity": 2, "price": 125.5 }],
  "deliveryAddress": "Calle Ficticia 100",
  "priority": "normal"
}
```

Cada item permite solo `name`, `quantity` y `price`. La cantidad debe ser un entero seguro positivo y el precio un número finito no negativo; no se convierten cadenas numéricas. Los textos deben ser no vacíos. Se rechazan campos extra, incluidos `total`, `status`, `id` y `_id`. Toda la validación sintáctica ocurre antes de consultar al cliente.

El servidor calcula `total = sum(quantity * price)`, comprueba que sea finito y fija `status: "created"`. Responde 201 con `{status: "success", payload: order}`; en el ejemplo, el total es 251. Incluye los IDs y timestamps de persistencia. Un cliente válido inexistente produce 404 `USER_NOT_FOUND`; un ID mal formado, 400 `INVALID_ID`; un rol incompatible, prioridad o datos inválidos, 400 `VALIDATION_ERROR`. El parser conserva 400 `INVALID_JSON` y 413 `PAYLOAD_TOO_LARGE`; la persistencia traduce conflictos a 409 `DUPLICATE_KEY` y fallos internos a 500 `DATABASE_ERROR`.

El alta ordinaria escribe en la base configurada de la aplicación, sin exigir `shipnow_mock_dev`. Solo crea el pedido: no crea cliente, producto ni entrega. No hay endpoint de actualización de estado. Tras confirmar la escritura se registra un evento `info` `order.created` correlacionado con `X-Request-Id`, sin direcciones, correos ni IDs del cliente. Para verificar el alta sin modificar la base de trabajo, usar la suite funcional aislada.

## Documentos y comprobantes privados

Cada petición acepta un solo archivo multipart, de **hasta 5 MiB inclusivos (5 242 880 bytes)**. Se valida MIME, tamaño y firma inicial desde disco; este control básico no equivale a un análisis integral del archivo.

| POST | Archivo (File) | Campo de texto | Formatos |
| --- | --- | --- | --- |
| /api/users/:uid/documents | document | type=user_document | PDF, JPEG, PNG |
| /api/users/:uid/documents | document | type=driver_license; requiere perfil driver | PDF |
| /api/deliveries/:did/proof | proof | Ninguno; type=delivery_proof lo fija el servidor | PDF, JPEG, PNG |

No se admiten campos extra, repetidos, valores anidados ni archivos vacíos. El orden entre type y archivo es indiferente. Se comprueba que el ID sea válido y la entidad exista antes de escribir en disco. Estos endpoints escriben en la base configurada; no exigen la base de mocks.

El éxito devuelve **201**, X-Request-Id y un cuerpo con status=success y payload: {userId, document} o {deliveryId, proof}. Solo incluye los metadatos del archivo recién asociado: originalName saneado (máximo 120 caracteres), filename UUID con extensión canónica, path relativo interno, mimeType verificado, size en bytes, type y uploadedAt. Los contratos anteriores de consultas, altas, modificaciones y mocks no exponen los arreglos privados.

| HTTP | Códigos |
| --- | --- |
| 400 | INVALID_ID, FILE_REQUIRED, INVALID_UPLOAD_FIELD, INVALID_MULTIPART; en documentos también INVALID_DOCUMENT_TYPE |
| 404 | USER_NOT_FOUND o DELIVERY_NOT_FOUND |
| 413 | FILE_TOO_LARGE |
| 415 | INVALID_FILE_TYPE |
| 500 | FILE_SAVE_ERROR, DATABASE_ERROR o INTERNAL_SERVER_ERROR |

Los parsers generales conservan INVALID_JSON (400) y PAYLOAD_TOO_LARGE (413) si se envía un cuerpo JSON malformado o excesivo en lugar del formulario. Los errores conservan {status, error, message} y X-Request-Id, sin detalles internos.

### Comprobación con Swagger UI o Postman

1. Iniciar la aplicación y obtener IDs propios con GET /api/users y GET /api/deliveries. Si no hay usuarios, crear un perfil ficticio con POST /api/users. Para disponer de drivers y entregas de práctica, usar el lote de mocks descrito abajo, únicamente en shipnow_mock_dev; sus GET de vista previa no persisten entidades.
2. En Swagger UI, abrir Users → POST /api/users/{uid}/documents → Try it out. Completar uid, elegir type=user_document y seleccionar un PDF, JPEG o PNG ficticio. Execute debe responder 201 con la nueva metadata.
3. Para una licencia, elegir un perfil cuyo role sea driver, type=driver_license y un PDF ficticio. El alta pública de usuarios no permite asignar role.
4. Para un comprobante, abrir Deliveries → POST /api/deliveries/{did}/proof, completar did y seleccionar el archivo en proof. No agregar type ni otros campos. La operación no cambia el estado de la entrega.
5. En Postman, crear una petición POST con la misma URL y seleccionar Body → form-data. Cambiar document o proof a **File** y elegir el archivo. Solo para documentos, agregar type como **Text**. Dejar que Postman genere Content-Type y boundary; quitar cualquier Content-Type manual heredado.
6. Revisar el 201, X-Request-Id y la metadata. Un GET normal de la entidad no muestra documents ni proofs, y GET sobre el path privado devuelve 404. Cada POST exitoso agrega una asociación; no reemplaza la anterior.

### Almacenamiento y límites operativos

La raíz uploads se resuelve desde el módulo, independientemente del directorio de ejecución. Las carpetas documents, licenses, proofs y temporary se crean automáticamente al necesitarlas. Solo UUID y destinos constantes del servidor forman las rutas; el nombre del archivo enviado nunca define la ubicación. Se usa Multer diskStorage, sin cargar archivos completos en memoria.

El flujo es temporal → validación → traslado definitivo → asociación mediante $push con validadores y sin upsert. Dos cargas concurrentes conservan sus asociaciones. Los intentos rechazados se limpian sin tocar archivos anteriores. Un archivo ya asociado se conserva aunque falle la respuesta HTTP. Si falla una escritura de MongoDB, se consulta su asociación por filename: se limpia al confirmar que no fue asociada, o se responde éxito si se confirma. Si la base tampoco permite comprobarlo, se conserva el archivo, se responde error y se registra upload.reconciliation_required. MongoDB y disco local no comparten una transacción.

Los eventos user.document_added y delivery.proof_added se emiten después de confirmar la asociación. Los fallos de limpieza registran upload.cleanup_failed sin ocultar el error original. Los logs no incluyen nombres originales, rutas ni contenido.

**Instancia académica sin autenticación ni control de acceso por usuario: usar exclusivamente archivos ficticios, nunca documentos personales reales.** uploads no se sirve como contenido estático y no hay endpoint de descarga. El disco local requiere respaldo junto con MongoDB y no es almacenamiento compartido para varias instancias.

Eliminar un perfil conserva sus archivos físicos; no hay borrado automático de documentos ni comprobantes. La administración fuera de la API debe conciliar los nombres de disco contra documents.filename/proofs.filename en MongoDB, resolver resultados ambiguos con la base disponible y revisar respaldos antes de retirar archivos sin referencia. No eliminar un archivo basándose solamente en un error HTTP.

/uploads/ y /src/public/img/uploads/ están ignorados por Git y nodemon. El catálogo mantiene su carga pública de imágenes hasta 2 MiB y sus URLs /img/uploads/. Los cinco JPEG históricos se versionan como recursos de catalog-legacy y conservan esas URLs mediante un alias, después de resolver el árbol público habitual.

## Documentación OpenAPI

La UI y el JSON están disponibles en desarrollo, pruebas y producción. La especificación se construye una vez por proceso con swagger-jsdoc, usando rutas absolutas independientes del directorio de ejecución. No requiere autenticación. Abrir la documentación no modifica datos; **Try it out ejecuta peticiones reales**.

| Tag | Alcance |
| --- | --- |
| Users | Listado, alta, detalle, actualización parcial mediante PUT, eliminación y documentos privados |
| Orders | Alta, listado con filtros y detalle de pedidos persistidos |
| Deliveries | Listado con filtros, detalle de entregas persistidas y comprobantes privados |
| Mocks | Vistas previas y cargas ficticias transaccionales |
| Logger | Diagnóstico de los seis niveles de logging |
| Health | Disponibilidad HTTP independiente de MongoDB |

La especificación cubre 22 operaciones en 17 paths y reutiliza schemas, parámetros y respuestas. Productos, carritos, vistas y sockets conservan el alcance descrito en este README. Mocks y Logger se muestran en Swagger, pero sus rutas siguen respondiendo 404 `ROUTE_NOT_FOUND` en producción.

### Recorrido en navegador

1. Con el servidor iniciado, abrir [Swagger UI](http://localhost:8080/api/docs/).
2. Desplegar **Health → GET /api/health → Try it out → Execute**. Debe responder 200 con `status: "ok"`, `timestamp` y la cabecera `X-Request-Id`.
3. En **Orders → GET /api/orders**, usar `status=created`, `page=1`, `limit=10`. En **Deliveries → GET /api/deliveries**, usar `status=pending`. Una lista vacía también es una respuesta 200 válida.
4. Para detalles, copiar un `id` de un listado y usarlo en `oid` o `did`. Los IDs simulados de las vistas previas de mocks no garantizan documentos persistidos.
5. En desarrollo o pruebas, ejecutar **Logger → GET /loggerTest** y luego Health. El diagnóstico devuelve 200 y el fatal simulado no detiene el servidor.

Para reproducir los errores sin depender de la validación del formulario de Swagger, ejecutar en otra terminal de PowerShell:

```powershell
$baseUrl = "http://localhost:8080"
curl.exe -i "$baseUrl/api/orders?status=no-existe"
curl.exe -i "$baseUrl/api/deliveries?status=no-existe"
curl.exe -i "$baseUrl/api/mocks/users?qty=-1"
```

Se esperan 400 con `INVALID_ORDER_STATUS`, `INVALID_DELIVERY_STATUS` e `INVALID_MOCK_AMOUNT`, respectivamente; el último requiere desarrollo o pruebas. El cuerpo conserva `status`, `error` y `message`; el estado HTTP y `X-Request-Id` viajan en la respuesta.

### Carga ficticia desde Swagger

Solo con la conexión activa a `shipnow_mock_dev`, transacciones disponibles y entorno de desarrollo o pruebas: abrir **Mocks → POST /api/mocks/generateData → Try it out**, sin query, y enviar:

```json
{ "users": 1, "drivers": 1, "orders": 1, "deliveries": 1 }
```

La respuesta esperada es 201:

```json
{ "status": "success", "payload": { "insertados": { "users": 1, "drivers": 1, "orders": 1, "deliveries": 1 } } }
```

Cada ejecución agrega documentos nuevos. En este ejemplo, el pedido y la entrega quedan `assigned`; se pueden consultar con ese filtro. En otra base, el guard responde 403 antes de escribir. No es un error de autenticación. Las reglas completas de cantidades y relaciones están en la sección de mocks.

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
| 400 | `INVALID_JSON`, `INVALID_ID`, `VALIDATION_ERROR`, `INVALID_ORDER_STATUS`, `INVALID_DELIVERY_STATUS`, `INVALID_MOCK_AMOUNT`, `INVALID_MOCK_DATA`, `UPLOAD_ERROR` |
| 403 | `MOCK_DATABASE_FORBIDDEN` |
| 404 | `ROUTE_NOT_FOUND`, `USER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CART_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`, `DELIVERY_NOT_FOUND` |
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

## Logging y monitoreo básico

El servidor inicializa un único logger después de validar la configuración. Importar la aplicación o la fábrica del logger no abre archivos ni conecta servicios. Los tests pueden inyectar un logger sin archivos.

| Nivel | Prioridad | Uso |
| --- | --- | --- |
| `fatal` | 0 | Fallos terminales de configuración, conexión o servidor |
| `error` | 1 | Errores HTTP 5xx |
| `warning` | 2 | Errores HTTP 4xx y avisos operativos de mejor esfuerzo |
| `info` | 3 | Arranque, conexión y lotes confirmados |
| `http` | 4 | Acceso HTTP: método, estado y duración |
| `debug` | 5 | Inicio de generación con cantidades validadas |

Winston admite los niveles con prioridad numérica menor o igual al umbral. En `development` y `test`, la consola muestra desde `debug`, con timestamp y metadatos legibles. En `production`, muestra desde `info` en JSON; no incluye accesos `http` ni eventos `debug`. No se requiere una variable adicional.

El archivo admite únicamente `error` y `fatal`, independientemente del umbral de consola. Se escribe JSON por línea en `logs/errors-%DATE%.log`, con fecha `YYYY-MM-DD`, rotación a los 10 MB y retención de 14 días. La auditoría usa `logs/.errors-audit.json`; no se crean enlaces simbólicos. Git ignora `/logs/` y `*.log`, y nodemon excluye `logs/**` para evitar reinicios por la rotación.

Si falla el archivo, se deshabilita ese destino y se emite un aviso operativo constante, una sola vez, sin interrumpir la consola ni las respuestas HTTP. El cierre espera el vaciado de logs. Un fallo real de arranque registra `fatal` y termina con código distinto de cero.

Cada petición recibe un UUID generado por el servidor en `X-Request-Id`. AsyncLocalStorage correlaciona acceso, error y generación de mocks, incluso con solicitudes simultáneas. El acceso registra duración con reloj monotónico; los éxitos de mocks se registran después de confirmar la transacción, fuera de su callback reintentable.

Los metadatos se filtran mediante una lista de permitidos. No se registran URLs ni segmentos dinámicos, query, body, credenciales, cookies, datos personales, excepciones crudas, causas ni stacks. Los mensajes son constantes o provienen del diccionario público de errores.

Ejemplo ficticio de registro:

```json
{"timestamp":"2026-01-01T12:00:00.000Z","level":"error","message":"Error interno del servidor","event":"http.error","code":"INTERNAL_SERVER_ERROR","statusCode":500,"method":"GET","requestId":"12345678-1234-4234-8234-123456789abc"}
```

### Diagnóstico con Postman

1. Importar [Errores HTTP y logging](postman/ShipNow-Errores.postman_collection.json) y ajustar su variable `baseUrl` al puerto configurado, por ejemplo `http://localhost:8080`.
2. En `development` o `test`, ejecutar la carpeta **03 - Logging sin escrituras**. GET `/loggerTest` devuelve 200 y `{"status":"success","message":"Logs de diagnóstico generados"}`.
3. Abrir **Test Results** y copiar `X-Request-Id` desde las cabeceras de respuesta. En consola aparecen seis eventos `logger.test`, uno por nivel, con `synthetic: true`, y un acceso `http.access`. El `fatal` simulado no apaga el servidor.
4. Enviar GET `/api/health`: devuelve 200 con `status: "ok"` y su propio ID. Enviar GET `/api/mocks/users?qty=-1`: devuelve 400 `INVALID_MOCK_AMOUNT` y genera un `warning`, sin insertar datos.
5. Buscar el ID del diagnóstico en la consola y en los archivos para correlacionar esa petición. En producción, `/loggerTest` responde el 404 habitual `ROUTE_NOT_FOUND` y no emite eventos simulados.

Desde PowerShell en la raíz, luego del diagnóstico:

```powershell
$requestId = "PEGAR-EL-X-REQUEST-ID-DEL-DIAGNOSTICO"
$entries = @(Get-ChildItem -LiteralPath .\logs -File |
  Where-Object { $_.Name -match "^errors-.*\.log(\.\d+)?$" } |
  Get-Content | Where-Object { $_.Trim() } | ConvertFrom-Json)
$entries | Where-Object { $_.requestId -eq $requestId }
$unexpected = @($entries | Where-Object { $_.level -notin @("error", "fatal") })
if ($entries.Count -eq 0) { throw "No hay registros: ejecutar primero el diagnóstico." }
if ($unexpected.Count -gt 0) { throw "Se encontraron niveles inesperados." }
"Archivo verificado: solo error y fatal."
```

El ID del diagnóstico debe tener dos registros persistidos: `error` y `fatal`. Los avisos 4xx quedan en consola, no en estos archivos.

## Testing

Instalar las dependencias, incluidas las de desarrollo, desde el lock:

```powershell
npm.cmd ci
```

La suite completa ejecuta primero las regresiones y después las pruebas funcionales:

```powershell
npm.cmd test
```

También se pueden ejecutar por separado:

```powershell
npm.cmd run test:regression
npm.cmd run test:functional
```

- **node:test** (`test/`): regresiones de catálogo, carritos, vistas, uploads, Socket.io, perfiles, pedidos, entregas, mocks, persistencia, configuración y logging. Valida OpenAPI y sus referencias internas sin resolución externa, el inventario de 22 operaciones y los assets de Swagger.
- **Mocha** (`tests/functional/`): organiza los casos por recurso y ejecuta hooks de preparación y limpieza. **Chai** verifica estados HTTP, cabeceras, contratos y valores. **Supertest** envía peticiones a `createApp(...)` con routers, parsers, controllers, servicios y middleware reales.

La configuración funcional está en `tests/support/`. Un preload exclusivo de Mocha fija `NODE_ENV=test`, y cada fábrica recibe el entorno explícitamente; los casos de producción lo seleccionan por app. **No hay variables que completar, no se lee .env, no se usa MONGODB_URI y no se necesita MongoDB ni un servidor iniciado previamente.**

El equivalente de una base de test son repositorios efímeros en memoria, independientes de la configuración de desarrollo. `beforeEach` crea fixtures, logger y app nuevos; `afterEach` descarta su estado. Supertest abre y cierra puertos efímeros con cada petición esperada con `await`; no usa localhost:8080 ni `--exit`. No se limpian colecciones reales y las precondiciones pertenecen al propio caso.

Las pruebas funcionales cubren éxito y errores documentados de Users, Orders, Deliveries, Mocks, Logger y Health. Incluyen alta de pedidos, tipos estrictos, cálculo del total, referencias de cliente, paginación, filtros, errores de parser, fallos de persistencia, guard transaccional y correlación. Un chequeo final contrasta las respuestas ejercitadas con la matriz de estados HTTP de OpenAPI. Los fallos se inyectan en los límites de persistencia, no en rutas artificiales.

Las cargas privadas se prueban con archivos sintéticos y directorios temporales por caso: bytes exactos, MIME/firma, límites, abortos, concurrencia, limpieza, fallos de disco, resultados ambiguos y conservación tras fallo de respuesta. Las regresiones verifican el $push, los esquemas y las URLs históricas del catálogo.

La suite ordinaria no demuestra escrituras ni atomicidad de MongoDB real; esa comprobación se ejecuta por separado.

### Integración con MongoDB

La comprobación real de rollback se ejecuta por separado:

```powershell
node --test test/integration/mocks-transaction.js
```

Requiere la URI local configurada para `shipnow_mock_dev`, entorno distinto de producción y Atlas o un replica set. Verifica la base activa antes de cargar modelos, intenta insertar un lote dentro de una transacción, provoca un fallo y comprueba que esos documentos no queden persistidos. No borra documentos anteriores. Los dobles de la suite ordinaria comprueban coordinación y propagación, no la atomicidad del servidor MongoDB.
