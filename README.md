# ShipNow / Rina

API de gestión de catálogo, perfiles, pedidos y entregas. Rina es la tienda de ejemplo, con vistas Handlebars, carrito y actualización del catálogo mediante Socket.IO.

El proyecto permite crear pedidos, asignar conductores, registrar el avance de un envío y adjuntar documentos o comprobantes. Está diseñado para revisión local con datos ficticios: no incorpora autenticación, pagos ni transportistas externos.

## Inicio con Docker

Requiere Docker Desktop iniciado en modo Linux y Docker Compose. No necesita Atlas ni un archivo `.env` para esta modalidad.

```powershell
docker compose --env-file .env.example -p shipnow-final up -d --build --wait
docker compose --env-file .env.example -p shipnow-final ps
```

- Catálogo: http://localhost:8082/products
- Swagger: http://localhost:8082/api/docs/
- Salud HTTP: http://localhost:8082/api/health

`docker compose` es el comando actual que sustituye al antiguo ejecutable `docker-compose`.

La API espera a que MongoDB sea PRIMARY en el replica set local `rs0`. El inicializador es idempotente y rechaza configuraciones incompatibles. MongoDB no publica un puerto al host. La API se publica solo en `127.0.0.1`; esta topología no está preparada para exposición a Internet.

La base `shipnow_final`, los archivos y los logs usan volúmenes propios del proyecto Compose. Detener y volver a levantar conserva los datos:

```powershell
docker compose --env-file .env.example -p shipnow-final down
docker compose --env-file .env.example -p shipnow-final up -d --wait
```

No utilizar `down -v` para detener el proyecto. Para otro puerto del host, definir `$env:COMPOSE_HTTP_PORT="8084"` antes de los comandos. `PORT` sigue siendo `8080` dentro del contenedor. Compose configura su URI interna explícitamente y no inyecta la conexión privada de `.env`.

## Desarrollo local

Requiere Node.js compatible con `engines` de `package.json` (mínimo 22.22.2) y un replica set de MongoDB o Atlas. `.nvmrc` y Docker fijan Node 24.22.3.

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```

Antes de iniciar, completar privadamente `MONGODB_URI` en `.env`. La configuración de aplicación contiene `PORT`, `NODE_ENV`, `MONGODB_URI` y `LOG_LEVEL`. Para desarrollo: `PORT=8080`, `NODE_ENV=development`, `LOG_LEVEL=debug`. No versionar credenciales.

Los mocks persistentes solo se habilitan en desarrollo sobre la base efectiva `shipnow_mock_dev`. En producción, `/api/mocks/*` y `/loggerTest` responden 404. También puede utilizarse un entorno de demostración local independiente, sin Atlas:

```powershell
$env:COMPOSE_HTTP_PORT="8083"
docker compose --env-file .env.example -p shipnow-demo -f docker-compose.yml -f docker-compose.demo.yml up -d --build --wait
```

Este proyecto separado utiliza sus propios volúmenes y `shipnow_mock_dev`. Swagger está en http://localhost:8083/api/docs/. Cada POST exitoso de mocks agrega documentos. Al terminar:

```powershell
docker compose --env-file .env.example -p shipnow-demo -f docker-compose.yml -f docker-compose.demo.yml down
Remove-Item Env:COMPOSE_HTTP_PORT
```

## Pedidos y entregas

`Order` representa el pedido/envío. `Delivery` registra su asignación operativa y comprobantes; no existe una colección paralela Shipment.

| Operación | Endpoint | Comportamiento |
| --- | --- | --- |
| Crear y listar pedidos | `POST /api/orders`, `GET /api/orders` | Cliente existente con rol user; total calculado por el servidor |
| Consultar y editar | `GET /api/orders/{oid}`, `PUT /api/orders/{oid}` | Edición parcial de items, dirección o prioridad solo en created |
| Baja lógica | `DELETE /api/orders/{oid}` | Solo created sin entrega; después queda oculto |
| Cambiar estado | `PATCH /api/orders/{oid}/status` | Valida transición y conserva historial |
| Seguimiento | `GET /api/orders/{oid}/tracking` | Estado e historial sin datos personales |
| Crear entrega | `POST /api/deliveries` | Una por pedido; driver opcional |
| Asignar conductor | `PATCH /api/deliveries/{did}/driver` | Solo entrega pending de un pedido created |

Estados: `created → assigned → picked_up → in_transit → delivered`. Es posible cancelar desde `created` o `assigned`; `delivered` y `cancelled` son terminales. Repetir el estado actual no agrega historial ni duplica el evento de éxito.

Una entrega sin conductor queda `pending`. Crear o asignar una entrega con un perfil `driver` cambia también el pedido a `assigned`, dentro de la misma transacción. Los perfiles se crean con rol `user` o `driver`; el rol no puede editarse y los perfiles referenciados no pueden eliminarse.

Los pedidos admiten hasta 100 items, nombres de hasta 200 caracteres y direcciones de hasta 500. Cantidades y precios deben ser números JSON. Se rechazan campos protegidos como `total`, `customer` en una edición y estados fuera del flujo. El historial de documentos anteriores o mocks sin eventos se informa como incompleto, sin inventar movimientos.

## Archivos y catálogo

- Documentos: `POST /api/users/{uid}/documents`, formulario con `document` como archivo y `type` como texto (`user_document` o `driver_license`, según perfil).
- Comprobantes: `POST /api/deliveries/{did}/proof`, campo `proof` como archivo.
- Se admite PDF, JPEG y PNG de hasta 5 MiB, validando MIME, firma y contenido no vacío. Los metadatos se almacenan en MongoDB; los archivos privados no se publican como recursos estáticos.
- El catálogo conserva su carga de imagen de hasta 2 MiB y los cinco recursos históricos. Productos y carritos también están documentados en Swagger.

## Pruebas

```powershell
npm.cmd test
```

Este es el comando completo de aceptación: ejecuta regresiones, pruebas HTTP con dobles y pruebas con **MongoDB real**. Requiere Docker Desktop y `docker` disponible en PATH. El runner crea un proyecto temporal con nombre único, sin puertos publicados ni acceso a Atlas; utiliza exclusivamente `shipnow_test` y elimina sus recursos al finalizar.

```powershell
npm.cmd run test:fast         # Regresión y HTTP sin MongoDB
npm.cmd run test:integration  # MongoDB real, replica set aislado
npm.cmd run verify:compose    # Imagen de producción, reinicio y persistencia
```

La verificación Compose usa otro proyecto nuevo, detiene sus contenedores y conserva sus volúmenes, mostrando el nombre generado. No afecta los datos del proyecto de trabajo. Procedimientos y alcance: [Pruebas y revisión manual](docs/testing.md).

## Logs y operación

Winston escribe JSON con fecha y metadatos permitidos:

- `logs/error.log`: únicamente `error` y `fatal`, independientemente de `LOG_LEVEL`.
- `logs/combined.log`: eventos aceptados por `LOG_LEVEL`; admite `fatal`, `error`, `warning`, `info`, `http` y `debug`.
- Cada destino rota a partir de 10 MiB y conserva hasta cinco archivos. La consola se habilita únicamente en development.

En producción es normal que `docker compose logs api` esté vacío. Para leer la actividad:

```powershell
docker compose --env-file .env.example -p shipnow-final exec api node -e "console.log(require('fs').readFileSync('/app/logs/combined.log','utf8'))"
```

`/api/health` verifica disponibilidad HTTP, no ejecuta consultas de negocio. El cierre drena peticiones, Socket.IO, MongoDB y logs dentro de un plazo global de 10 segundos; Compose concede 20 segundos.

## Estructura

`src/routes` y `src/controllers` definen HTTP; `src/services` concentra reglas; `src/repositories` opera MongoDB; `src/models` define esquemas e índices. `src/docs` contiene OpenAPI, `src/mocks` los generadores y `scripts` la inicialización y verificación de Docker.

Las transacciones conservan los errores originales de MongoDB hasta completar los reintentos del driver. Actualizaciones condicionadas y revisiones compartidas evitan estados parciales y referencias huérfanas ante operaciones concurrentes. Más detalles: [Arquitectura](docs/architecture.md).
