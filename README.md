# ShipNow / Rina

Aplicación de catálogo y carritos para accesorios, con Rina como tienda de ejemplo. Incluye perfiles de usuarios, generación de datos ficticios relacionados y consultas de pedidos y entregas. No realiza envíos ni pagos reales.

Utiliza CommonJS, Express 4, Mongoose 9, Handlebars, Socket.io, Multer y Winston. Los generadores usan `node:crypto`; las pruebas usan `node:test`.

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
| POST | `/api/carts` | Crear carrito |
| GET / PUT / DELETE | `/api/carts/:cid` | Consultar / reemplazar productos / vaciar carrito |
| POST | `/api/carts/:cid/product/:pid` | Agregar producto |
| PUT / DELETE | `/api/carts/:cid/products/:pid` | Cambiar cantidad / quitar producto |
| GET | `/api/orders/:oid` | Consultar un pedido persistido |
| GET | `/api/orders` | Listar pedidos, con `status`, `page` y `limit` opcionales |
| GET | `/api/deliveries` | Listar entregas persistidas, con `status`, `page` y `limit` opcionales |
| GET | `/api/deliveries/:did` | Consultar una entrega persistida |

Productos, usuarios, pedidos y entregas admiten `page` y `limit`: valores predeterminados 1 y 10, máximo 100 por página. Productos admite además `sort=asc|desc` por precio y `query` por categoría o disponibilidad (`true|false`). Pedidos usa orden estable por fecha descendente e identificador ascendente. Rechaza filtros desconocidos; `status` debe ser `created`, `assigned`, `picked_up`, `in_transit`, `delivered` o `cancelled`.

Entregas acepta `status=pending|assigned`, rechaza filtros desconocidos y usa el mismo orden estable que pedidos. Devuelve `order`, `driver` cuando existe, `status`, `createdAt`, `updatedAt`, `_id` e `id`. Las referencias son IDs, sin perfiles populados. Una entrega pendiente puede omitir `driver`. Estas consultas son de lectura y funcionan fuera de la base dedicada a mocks. No se ofrecen operaciones para crear, actualizar o eliminar entregas por esta API.

Los perfiles contienen `firstName`, `lastName`, `email` y `role`, sin contraseña. El alta pública asigna `user` y no permite escribir `role`. Productos acepta una imagen en el campo multipart `image`, hasta 2 MB; una creación fallida limpia el archivo subido. Las notificaciones Socket.io no revierten una escritura ya confirmada.

Vistas: `/` redirige a `/products`; también están disponibles `/products/:pid`, `/realtimeproducts` y `/carts/:cid`. Se conservan sus imágenes y eventos de actualización del catálogo.

## Documentación OpenAPI

La UI y el JSON están disponibles en desarrollo, pruebas y producción. La especificación se construye una vez por proceso con swagger-jsdoc, usando rutas absolutas independientes del directorio de ejecución. No requiere autenticación. Abrir la documentación no modifica datos; **Try it out ejecuta peticiones reales**.

| Tag | Alcance |
| --- | --- |
| Users | Listado, alta, detalle, actualización parcial mediante PUT y eliminación |
| Orders | Listado con filtros y detalle de pedidos persistidos |
| Deliveries | Listado con filtros y detalle de entregas persistidas |
| Mocks | Vistas previas y cargas ficticias transaccionales |
| Logger | Diagnóstico de los seis niveles de logging |
| Health | Disponibilidad HTTP independiente de MongoDB |

La especificación cubre 19 operaciones y reutiliza schemas, parámetros y respuestas. Productos, carritos, vistas y sockets conservan el alcance descrito en este README. Mocks y Logger se muestran en Swagger, pero sus rutas siguen respondiendo 404 `ROUTE_NOT_FOUND` en producción.

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

## Pruebas y verificación

Las verificaciones se reproducen con los comandos siguientes; sus resultados dependen del código y del entorno de ejecución.

### Suite local

```powershell
npm.cmd test
```

La suite usa servidores efímeros y dobles de persistencia, sin conectar a Atlas. Comprueba catálogo, carritos, perfiles, uploads, Socket.io, pedidos, entregas, errores HTTP, mensajes seguros, límites y coordinación transaccional. También verifica niveles y rotación de Winston en directorios temporales, fallos de escritura, correlación de peticiones simultáneas, confidencialidad y cierre del servidor ante fallos de arranque. Valida OpenAPI con Swagger Parser y resolución externa deshabilitada, sus referencias internas, las 19 operaciones contra HTTP, los assets y el script de Swagger, y la carga desde otro directorio. Los fallos de base se simulan con dobles; no es necesario desconectar una base real.

### Integración con MongoDB

La comprobación real de rollback se ejecuta por separado:

```powershell
node --test test/integration/mocks-transaction.js
```

Requiere la URI local configurada para `shipnow_mock_dev`, entorno distinto de producción y Atlas o un replica set. Verifica la base activa antes de cargar modelos, intenta insertar un lote dentro de una transacción, provoca un fallo y comprueba que esos documentos no queden persistidos. No borra documentos anteriores. Los dobles de la suite ordinaria comprueban coordinación y propagación, no la atomicidad del servidor MongoDB.
