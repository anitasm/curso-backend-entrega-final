# Operación y desarrollo

## Docker

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

## Logs

Winston escribe JSON con fecha y metadatos permitidos:

- `logs/error.log`: únicamente `error` y `fatal`, independientemente de `LOG_LEVEL`.
- `logs/combined.log`: eventos aceptados por `LOG_LEVEL`; admite `fatal`, `error`, `warning`, `info`, `http` y `debug`.
- Cada destino rota a partir de 10 MiB y conserva hasta cinco archivos. La consola se habilita únicamente en development.

En producción es normal que `docker compose logs api` esté vacío. Para leer la actividad:

```powershell
docker compose --env-file .env.example -p shipnow-final exec api node -e "console.log(require('fs').readFileSync('/app/logs/combined.log','utf8'))"
```

`/api/health` verifica disponibilidad HTTP, no ejecuta consultas de negocio. El cierre drena peticiones, Socket.IO, MongoDB y logs dentro de un plazo global de 10 segundos; Compose concede 20 segundos.
