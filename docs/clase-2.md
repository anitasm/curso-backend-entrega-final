# Adaptación del material de Clase 2

Se revisaron el README, los módulos de src y los ejemplos de live de la carpeta Clase-2 suministrada por el profesor. El material se utiliza como referencia didáctica y se adapta al catálogo Rina y a los contratos de la preentrega existente.

## Qué aporta el material

- Separación Router → Controller → Service → Repository → Model.
- Generadores separados del servicio y escritura de perfiles con insertMany.
- Parámetros de mocking centralizados en constantes congeladas.
- GET y POST sobre /api/mocks/users; endpoint /api/health.
- Distinción entre stub (respuesta controlada), fake (implementación simplificada con estado), fixture (datos conocidos) y mock de interacción (registro de llamadas).

El ejemplo está incompleto: src/mocks/order.mocks.js declara generateMockOrder sin implementación; src/services/mocks.services.js deja vacíos seedOrders y seedDeliveries. Su README menciona archivos Postman que no están incluidos en la carpeta revisada. No contiene una rúbrica adicional que indique reemplazar todos los contratos de este proyecto.

## Decisiones de adaptación

| Tema | Ejemplo de clase | Implementación de esta entrega |
| --- | --- | --- |
| Módulos y ODM | ESM y Mongoose 8 | CommonJS y Mongoose 9, conservando la aplicación existente |
| Generación | Faker | node:crypto y listas ficticias; emails únicos @example.test |
| Perfiles | customer, driver, store; contraseña predeterminada y bcrypt | user y driver; sin contraseñas ni autenticación, como establece la consigna de esta entrega |
| Cantidades | DEFAULT 10, MAX 50 | MOCKING_PARAMETERS congelado con DEFAULT 10 y MAX 100; validación estricta y total de lote limitado a 100 |
| GET /api/mocks/users | status/payload con campos del modelo | Se conserva el arreglo nombre/email/rol; /mockingusers ofrece status/payload con los campos del modelo |
| POST /api/mocks/users | 200, status/payload con inserted/users/collection | Ruta incorporada con 201 por creación; devuelve los perfiles confirmados y collection: users, nombre real de la colección |
| POST /api/mocks/seed | No está en el router de clase | Se conserva el contrato insertados/coleccion y qty obligatorio |
| Pedidos y entregas | Generación pendiente de implementar | Lote completo con IDs persistidos, roles y estados coherentes |
| Escrituras | Inserción directa | Transacción compartida y bloqueo fuera de shipnow_mock_dev |
| Health | status: ok y timestamp | Incorporado; informa disponibilidad HTTP, no hace una consulta ni acredita salud de MongoDB |
| Ejemplos live | Pago y asignación según clima | Se aplica la técnica de dobles a las operaciones del proyecto, sin añadir pagos o clima al dominio |

Los roles existentes y los documentos almacenados no se migran. Los CRUD logísticos, documentos personales, tarifas, claves JWT y estados adicionales de reparto del ejemplo no se incorporan: no son necesarios para la consigna de mocking y ampliarían el alcance acordado.

## Pruebas y archivos para revisar

- test/mocks.interactions.test.js: estructura Arrange / Act / Assert, fixture conocida, stub transaccional y t.mock.fn para comprobar argumentos, sesión, cantidad de llamadas y respuesta posterior al commit.
- test/helpers/mocks-fixtures.js: repositorios falsos que asignan IDs y registran lotes; permiten comprobar relaciones sin Atlas.
- test/mocks.http.test.js: rutas, formatos, health y controles del nuevo POST.
- postman/ShipNow-Modulo-2.postman_collection.json: consultas, escrituras y casos inválidos con aserciones de respuesta.
- postman/ShipNow-Local.postman_environment.json: únicamente baseUrl local, sin secretos.

La colección contiene escrituras: cada ejecución de una petición POST válida agrega otro lote. Sus aserciones verifican respuestas, no reemplazan la prueba optativa de rollback contra MongoDB real.
