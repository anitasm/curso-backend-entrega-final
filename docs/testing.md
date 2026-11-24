# Pruebas y revisión manual

## Suites

| Comando | Alcance |
| --- | --- |
| `npm.cmd run test:regression` | Regresiones con node:test: validación, repositorios, archivos, configuración, logs y cierre |
| `npm.cmd run test:functional` | Mocha, Chai y Supertest; HTTP con dobles explícitos, sin Mongoose |
| `npm.cmd run test:integration` | Mocha/Supertest con modelos, repositorios y MongoDB reales, dentro de Docker |
| `npm.cmd test` | Las tres suites, sin omitir integración si Docker no está disponible |
| `npm.cmd run verify:compose` | Stack de producción nuevo: salud, persistencia, recreación, imagen y cierre |

`verify:compose` crea un proyecto de revisión propio, detiene sus contenedores al finalizar y conserva sus volúmenes; muestra el nombre generado para identificarlos.

La matriz funcional exige comprobar cada estado HTTP documentado en OpenAPI. Los errores de controlador también se prueban mediante dobles explícitos; eso no se presenta como evidencia de persistencia. La integración comprueba escrituras reales, rollback después de escribir, carreras entre operaciones incompatibles, perfiles referenciados, archivos y guards de mocks.

En Windows una prueba de SIGTERM se omite por la semántica de señales del sistema. El cierre real del contenedor Linux se verifica con Compose.

## Aislamiento

El runner genera un proyecto `shipnow-test-<uuid>`. MongoDB no publica puertos y usa almacenamiento temporal; el contenedor de pruebas recibe `TEST_MONGODB_URI` explícitamente. La suite verifica el nombre efectivo `shipnow_test` antes de escribir o limpiar. No carga `.env` ni toma `MONGODB_URI` de la aplicación.

El nombre de base por sí solo no constituye aislamiento: también se crea un contenedor, una red y un proyecto exclusivos. El runner conserva un resultado fallido y limpia en finally solo ese proyecto. Docker o Compose ausentes producen un error, nunca una omisión silenciosa.

## Flujo manual en Swagger

Levantar Compose según README y abrir `/api/docs/`. Cada operación debe ejecutar Try it out → Execute. Utilizar siempre los IDs devueltos por la API.

1. Crear un perfil con `POST /api/users`: firstName, lastName, email ficticio; role omitido o user. Guardar `payload.id` como cliente.
2. Crear otro perfil con email diferente y role driver. Guardar su ID.
3. Crear el pedido con `POST /api/orders`:

```json
{
  "customer": "ID_DEL_CLIENTE",
  "items": [{ "name": "Producto ficticio", "quantity": 2, "price": 100 }],
  "deliveryAddress": "Dirección ficticia 100",
  "priority": "normal"
}
```

4. Esperar 201, total 200 y status created. Guardar el ID del pedido. Editar su dirección o items con `PUT /api/orders/{oid}` y comprobar el total recalculado.
5. Crear `POST /api/deliveries` con `{"order":"ID_DEL_PEDIDO"}`. Esperar 201 y pending. Guardar el ID de entrega.
6. Asignar `PATCH /api/deliveries/{did}/driver` con `{"driver":"ID_DEL_CONDUCTOR"}`. Esperar 200; consultar el pedido para confirmar assigned.
7. Ejecutar `PATCH /api/orders/{oid}/status` sucesivamente con picked_up, in_transit y delivered. Cada solicitud lleva `{"status":"ESTADO"}` y devuelve 200.
8. Consultar `/api/orders/{oid}/tracking`: historial ordenado, sin dirección ni datos personales. Repetir delivered devuelve 200 sin una entrada adicional; intentar volver a created devuelve 409.
9. Crear otro pedido sin entrega y eliminarlo con DELETE. Devuelve 200 con deleted=true; su GET posterior devuelve 404. Un pedido con entrega devuelve 409 ante la baja.
10. Intentar eliminar un cliente o conductor referenciado devuelve 409 USER_IN_USE. Un perfil libre puede eliminarse.

## Archivos

Adjuntar un PDF, JPEG o PNG ficticio de hasta 5 MiB. Para usuario, usar `POST /api/users/{uid}/documents`, archivo document y texto type=user_document. Para licencia, usar un perfil driver y type=driver_license. Para entrega, usar `POST /api/deliveries/{did}/proof`, archivo proof, sin type.

Esperar 201 y metadatos. En Postman usar Body → form-data, el campo de archivo como File y type como Text. Dejar que Postman calcule Content-Type y su boundary. Guardar la solicitud no vuelve a ejecutar la carga.

La referencia path devuelta es privada: no es una URL de descarga. Los GET normales no exponen esos arreglos. No adjuntar documentos reales ni versionar archivos de prueba generados.

## Logs y mocks

Usar el proyecto separado shipnow-demo descrito en [Operación y desarrollo](operations.md#desarrollo-local). GET /loggerTest genera seis niveles; el fatal es simulado y no apaga la API. error.log contiene solo error/fatal y combined.log respeta el umbral. En el proyecto de producción las rutas internas deben devolver 404.

Los POST de mocks agregan datos nuevos; no reinician ni limpian la base. La generación de lotes se realiza en una transacción. Un lote con users=1, drivers=1, orders=1 y deliveries=1 permite comprobar referencias sin datos reales.

## Dependencias

`npm.cmd audit` incluye herramientas de desarrollo; `npm.cmd audit --omit=dev` analiza lo instalado en runtime. Los resultados dependen de la fecha de consulta. No aplicar `audit fix --force` automáticamente: revisar los cambios mayores y volver a ejecutar la aceptación completa. La imagen final instala solo dependencias de producción.
