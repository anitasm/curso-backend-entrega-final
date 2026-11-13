# ShipNow / Rina · Backend III

Emprendimiento de accesorios, con **Rina** como tienda de ejemplo. El módulo 1 aporta el catálogo, los carritos y los perfiles; el **módulo 2 incorpora generación de datos ficticios y carga de lotes relacionados**. No se realizan envíos reales ni se integra un proveedor logístico externo.

Tecnologías: Node.js, CommonJS, Express 4, MongoDB, Mongoose 9, Handlebars, Socket.io y Multer. El módulo de mocks utiliza `node:crypto`, sin dependencias nuevas.

## Arquitectura y cambios

```text
Router → Controller → Service → Repository → Model / MongoDB
                         ↓
                    Generadores
```

Los controllers adaptan HTTP; el servicio valida cantidades y coordina relaciones; los generadores producen datos ficticios; los repositorios insertan documentos. La transacción y la comprobación de la base activa pertenecen a persistencia y se inyectan desde `server.js`.

| Componente | Archivos principales |
| --- | --- |
| Rutas y respuestas | `src/routes/mocks.router.js`, `src/controllers/mocks.controller.js` |
| Validaciones y coordinación | `src/services/mocks.service.js` |
| Generadores | `src/mocks/users.generator.js`, `orders.generator.js`, `deliveries.generator.js` |
| Persistencia | `src/repositories/users.repository.js`, `orders.repository.js`, `deliveries.repository.js` |
| Transacciones y base permitida | `src/repositories/mock-transaction.js`, `src/config/mocks.config.js` |
| Modelos y constantes | `src/models/Order.js`, `Delivery.js`, `src/constants/index.js` |
| Montaje y composición | `src/app.js`, `src/server.js` |

Se agrega el rol `driver` al enum utilizado por User. Los clientes y repartidores comparten ese modelo, sin contraseñas. La API pública `/api/users` conserva sus restricciones: asigna `user` al crear y rechaza el campo `role` tanto en altas como en actualizaciones.

Se mantienen el catálogo Rina, Productos, Carritos, las vistas, imágenes y eventos de Socket.io. No se agregan CRUD públicos de pedidos o entregas. Importar `app.js` sigue sin cargar modelos, conectar a MongoDB ni iniciar un servidor.


## Ejecución

Desde la carpeta del proyecto, con la conexión local configurada:

```powershell
npm.cmd ci
npm.cmd run dev
```

`npm.cmd start` inicia sin reinicio automático. `npm.cmd test` ejecuta la suite independiente de Atlas. Si las dependencias ya están instaladas, no es necesario repetir `npm.cmd ci`.

## Rutas de mocks

Disponibles bajo `/api/mocks` en `development` y `test`, con servicio inyectado. En `production` no se montan y responden **404**.

| Método | Ruta | Respuesta exitosa |
| --- | --- | --- |
| GET | `/users?qty=2` | 200, arreglo con `nombre`, `email`, `rol` |
| GET | `/mockingusers?qty=2` | 200, `status/payload` con `firstName`, `lastName`, `email`, `role` |
| GET | `/mockingdrivers?qty=1` | 200, `status/payload` con perfiles `driver` |
| GET | `/mockingorders?qty=2` | 200, `status/payload` con pedidos ficticios |
| GET | `/mockingdeliveries?qty=2` | 200, `status/payload` con entregas ficticias |
| POST | `/users?qty=2` | 201, `status/payload` con `inserted`, `users` y `collection` |
| POST | `/seed?qty=10` | 201, `{"insertados":10,"coleccion":"usuarios"}` |
| POST | `/generateData` | 201, `status/payload` con los conteos confirmados |

Los dos GET de usuarios, POST `/users` y `/seed` comparten el generador que alterna clientes y repartidores; con dos perfiles devuelve ambos roles. La presentación traduce `user` a `cliente` y `driver` a `repartidor` solo en `/users`.

**Los GET generan en memoria y no llaman a repositorios.** Las referencias hexadecimales de 24 caracteres de sus pedidos y entregas son simuladas: no corresponden a documentos guardados. Los POST persisten; sus referencias provienen exclusivamente de documentos insertados en esa misma operación.

### Parámetros y límites

- `qty`: entero decimal entre **1 y 100**. Por defecto, 10 en GET y POST `/users`; obligatorio en `/seed`. Los valores se centralizan en `MOCKING_PARAMETERS`. Se rechazan decimales, valores vacíos, parámetros repetidos, arreglos y campos desconocidos.
- `/generateData`: body JSON con solo `users`, `drivers`, `orders` y `deliveries`. Cada valor explícito debe ser un entero numérico seguro entre 0 y 100; los omitidos valen cero. No acepta parámetros de query.
- El lote completo debe sumar **entre 1 y 100 documentos**. Para pedidos se requiere `users >= 1`; para entregas, `orders >= deliveries`.
- `users` cuenta clientes y `drivers` repartidores. Sin repartidores, las entregas quedan pendientes y sin `driver`.

Los límites son decisiones de implementación para acotar las cargas. Las entradas inválidas responden **400**, antes de ejecutar escrituras.

### Estados y consistencia

Las constantes y los enums usan una fuente única congelada con `Object.freeze`:

| Constante | Valores |
| --- | --- |
| `USER_ROLES` | `admin`, `user`, `driver` |
| `ORDER_STATUS` | `created`, `assigned`, `picked_up`, `in_transit`, `delivered`, `cancelled` |
| `DELIVERY_STATUS` | `pending`, `assigned` |
| `DELIVERY_PRIORITY` | `low`, `normal`, `high` |

Cada pedido contiene un cliente, ítems, dirección ficticia, total, estado y prioridad. Los importes generados son enteros pequeños y el total es la suma de cantidad por precio. Se crea como máximo una entrega por pedido, respaldada por un índice único en `Delivery.order`.

Con repartidor, la entrega y su pedido quedan `assigned`; sin repartidor, la entrega queda `pending` y el pedido `created`. Los clientes se eligen del grupo `user` insertado y los repartidores del grupo `driver`: una referencia ObjectId por sí sola no comprueba roles.

## Persistencia y protección de datos

Los POST solo pueden escribir si **la base real de la conexión activa es `shipnow_mock_dev`**. En cualquier otra base responden **403**. El nombre se comparte entre la comprobación de infraestructura y las pruebas; no se decide analizando una cadena de URI.

Cada POST ejecuta una transacción de Mongoose: primero perfiles, luego pedidos y finalmente entregas, usando la misma sesión y sin operaciones de lote vacías. Las colecciones e índices se inicializan antes de atender peticiones, fuera de la transacción. Los errores originales conservan sus etiquetas durante el callback para permitir los reintentos del driver y se traducen al finalizar. Los conteos solo se devuelven tras confirmar el lote.

Se requiere **Atlas o un replica set con soporte de transacciones**. Un servidor standalone responde **503** con una explicación; no existe una alternativa de escritura parcial. Un conflicto de clave única responde **409** y un fallo interno **500**, sin detalles sensibles.

### Usar una base separada en Atlas

1. Detener el servidor con `Ctrl+C`.
2. En el editor, guardar de forma privada la URI habitual. En el `.env` local, cambiar **solo el nombre de base dentro de `MONGODB_URI`** por `shipnow_mock_dev`, conservando credenciales, host y opciones de conexión.
3. Mantener `NODE_ENV=development` y comprobar que el usuario de Atlas tenga permisos de escritura sobre esa base.
4. Ejecutar `npm.cmd run dev` nuevamente. La base puede comenzar vacía; no es necesario copiar el catálogo histórico.
5. Para recuperar el catálogo habitual, restaurar la URI original y reiniciar.

No compartir credenciales. `.env` y `node_modules/` están ignorados; `.env.example` permanece sin secretos. Los GET de mocks pueden utilizarse con la base habitual porque generan en memoria. Al cambiar a la base dedicada, el catálogo puede verse vacío: los datos anteriores siguen en su base original.

## Recorrido en Postman

### Importar las peticiones

En Postman, usar **Import** y seleccionar estos archivos del repositorio:

- [Colección ShipNow — Módulo 2](postman/ShipNow-Modulo-2.postman_collection.json).
- [Entorno ShipNow Local](postman/ShipNow-Local.postman_environment.json).

Seleccionar **ShipNow Local**, cuyo único valor es `baseUrl=http://localhost:8080`. Ajustarlo si el servidor usa otro puerto. La colección incluye verificaciones automáticas de respuesta. Ejecutar primero la carpeta **Consultas sin escritura**; la carpeta **Escrituras** agrega datos cada vez que se ejecuta.

Probar primero GET `{{baseUrl}}/api/health`: debe responder 200 con `status: "ok"` y `timestamp`. Este endpoint informa que Express atiende peticiones; no consulta MongoDB.

### Pruebas paso a paso

Usar `http://localhost:8080` como URL base, o el puerto configurado localmente. Cada paso de escritura requiere la base dedicada indicada arriba.

**1. Previsualizar perfiles**

Crear una petición **GET** a `http://localhost:8080/api/mocks/users?qty=2`, sin body. Esperar **200**, dos perfiles y las etiquetas `cliente` y `repartidor`. Probar también `/api/mocks/mockingusers?qty=2` para ver el mismo tipo de datos con nombres de campos del modelo y `status/payload`.

**2. Insertar perfiles**

Crear una petición **POST** a `http://localhost:8080/api/mocks/seed?qty=10`, sin body. Esperar **201**:

```json
{ "insertados": 10, "coleccion": "usuarios" }
```

`usuarios` es la etiqueta del contrato; la colección real se llama `users`. El lote contiene cinco clientes y cinco repartidores.

También se puede usar la ruta vista en clase: **POST** `/api/mocks/users?qty=2`, sin body. Responde **201** con `status: "success"` y un `payload` que contiene `inserted: 2`, `users` (los dos perfiles guardados con sus identificadores) y `collection: "users"`.

Esta ruta agrega un lote adicional, tiene qty por defecto 10 y mantiene la misma transacción y restricción de base que `/seed`. No es necesario ejecutar ambas para probar una carga de perfiles.

**3. Insertar un lote relacionado**

Crear una petición **POST** a `http://localhost:8080/api/mocks/generateData`. Seleccionar **Body → raw → JSON** (`Content-Type: application/json`) e ingresar:

```json
{ "users": 2, "drivers": 1, "orders": 2, "deliveries": 2 }
```

Esperar **201**:

```json
{
  "status": "success",
  "payload": {
    "insertados": { "users": 2, "drivers": 1, "orders": 2, "deliveries": 2 }
  }
}
```

Cada POST agrega su propio lote con emails únicos `@example.test`; `generateData` no reutiliza perfiles de `/seed`. Si la base estaba vacía y se ejecuta cada POST una sola vez, habrá **13 perfiles, 2 pedidos y 2 entregas**.

Para probar entregas sin repartidor, enviar `{"users":1,"orders":1,"deliveries":1}`. Se agrega otro lote, con entrega pendiente y sin campo `driver`.

**4. Probar errores**

GET `/api/mocks/users?qty=101`, GET `/api/mocks/users?qty=1&qty=2` o POST `/api/mocks/generateData` con `{"orders":1}` deben responder **400** sin insertar registros. Los POST sobre la base habitual responden **403**. En producción, todas las rutas de mocks responden **404**.

**5. Revisar las relaciones en Atlas**

En **Data Explorer**, abrir la base `shipnow_mock_dev` y actualizar la vista de colecciones:

| Modelo | Colección real | Datos |
| --- | --- | --- |
| User | `users` | Clientes (`user`) y repartidores (`driver`) |
| Order | `orders` | Pedidos con `customer`, ítems y total |
| Delivery | `deliveries` | Entregas con `order` y `driver` opcional |
| Product | `products` | Catálogo existente; no lo generan los mocks |
| Cart | `carts` | Carritos existentes; no los generan los mocks |

- Copiar `customer` de un pedido y buscarlo como `_id` en `users`; el documento debe existir y tener `role: "user"`.
- Copiar `order` de una entrega y buscarlo como `_id` en `orders`; debe existir.
- Si la entrega tiene `driver`, buscar ese `_id` en `users`; debe existir y tener `role: "driver"`. Tanto la entrega como su pedido deben estar `assigned`.
- Sin `driver`, comprobar `pending` en la entrega y `created` en el pedido.

Ejemplo de filtro en `users`, reemplazando el texto por el identificador copiado:

```javascript
{ _id: ObjectId("ID_COPIADO"), role: "user" }
```

## Verificación

**45 pruebas automatizadas aprobadas:** las 39 existentes y 6 adicionales sobre health, la ruta de clase y dobles de prueba. Cubren formatos HTTP, límites y parámetros repetidos, ausencia de escrituras en GET, referencias persistidas, roles y estados, sesión compartida, fallo de la última escritura, producción con 404 y base no permitida con 403.

```powershell
npm.cmd test
```

La suite utiliza repositorios y transacciones de prueba explícitos, sin Atlas. Los dobles verifican la coordinación y propagación de errores, **no la atomicidad del servidor MongoDB real**. En el entorno de trabajo, el sandbox bloqueó localhost con EACCES; la ejecución autorizada fuera del sandbox pasó completa.

### Prueba de rollback real — optativa y pendiente

Con la URI local apuntando a `shipnow_mock_dev`, ejecutar por separado:

```powershell
node --test test/integration/mocks-transaction.js
```

## Entrega

Repositorio de esta entrega: [anitasm/curso-backend-modulo-2](https://github.com/anitasm/curso-backend-modulo-2). 
