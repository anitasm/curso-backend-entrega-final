# ShipNow / Rina

API de catálogo, perfiles, pedidos y entregas. Incluye la tienda Rina con Handlebars, carrito y actualizaciones por Socket.IO. Destinada a revisión local con datos ficticios; no incluye autenticación, pagos ni transportistas externos.

[Docker](#inicio-con-docker) · [Pruebas](#pruebas) · [Documentación](#documentación)

## Inicio con Docker

Requiere Docker Desktop iniciado en modo Linux y Docker Compose. No necesita Atlas ni crear un archivo `.env`.

```powershell
docker compose --env-file .env.example -p shipnow-final up -d --build --wait
docker compose --env-file .env.example -p shipnow-final ps
```

| Recurso | Dirección |
| --- | --- |
| Catálogo | http://localhost:8082/products |
| Swagger y endpoints | http://localhost:8082/api/docs/ |
| Salud HTTP | http://localhost:8082/api/health |

La API espera a MongoDB PRIMARY y se publica únicamente en localhost. En producción, mocks y `/loggerTest` están deshabilitados; los logs se guardan en archivos.

Para detener conservando la base, los archivos y los logs:

```powershell
docker compose --env-file .env.example -p shipnow-final down
```

No usar `down -v`. [Puertos, volúmenes, logs y desarrollo local](docs/operations.md).

## Pruebas

Con Node.js compatible con `package.json`, Docker Desktop iniciado y `docker` disponible en PATH:

```powershell
npm.cmd ci
npm.cmd test
```

Ejecuta regresiones, pruebas HTTP y MongoDB real en un proyecto temporal aislado, sin usar Atlas ni la base de trabajo. [Suites y revisión manual](docs/testing.md).

## Documentación

- [Operación y desarrollo](docs/operations.md): configuración, demostración de mocks y consulta de logs.
- [Arquitectura](docs/architecture.md): capas, transacciones, estados de pedidos y límites de archivos.
- [Pruebas](docs/testing.md): flujo de envío en Swagger, documentos y comprobantes.

Estructura principal: `src/routes → controllers → services → repositories → models`. Los contratos HTTP se consultan en Swagger.
