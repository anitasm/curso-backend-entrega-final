# Arquitectura

La aplicación es CommonJS sobre Express 4. `createApp` recibe sus servicios y no carga configuración, abre logs ni conecta MongoDB. `server.js` compone repositorios y servicios, conecta la base e inicializa todos los índices antes de escuchar, también en producción.

## Consistencia

Order representa pedido y envío. Su revisión interna permite actualizaciones condicionadas; estado e historial se guardan en una sola operación. Delivery tiene un índice único por order. Crear una entrega pendiente también modifica la revisión del pedido: así compite con una baja lógica sobre el mismo documento.

Asignar un conductor y cambiar el pedido a assigned se ejecutan en una transacción. Las operaciones dentro de la sesión son secuenciales. Los errores de MongoDB conservan sus etiquetas para que el driver pueda reintentar; la traducción al diccionario HTTP sucede al salir de la unidad de trabajo. Los eventos de éxito se registran después del commit.

La eliminación de un perfil y la creación de referencias comparten una escritura de revisión sobre User. Una lectura aislada de referencias no sería suficiente para evitar una carrera. Se conservan referencias históricas de pedidos eliminados lógicamente.

Las consultas normales excluyen historial, revisiones internas, documentos y comprobantes. Tracking devuelve únicamente orderId, estado, historyComplete e historial. Los registros heredados sin historial siguen siendo consultables y modificables cuando el estado lo permite; no se construyen eventos históricos supuestos.

## Almacenamiento y límites

Los documentos privados se validan durante la carga, se identifican con nombres generados por el servidor y se asocian con una operación atómica `$push`. Una carga fallida limpia sus propios archivos. Las pruebas verifican dos cargas concurrentes sin pérdida de metadatos. El catálogo conserva su almacenamiento público independiente.

MongoDB local utiliza un replica set de un nodo para permitir transacciones. No proporciona alta disponibilidad. En un entorno externo, las transacciones requieren Atlas o un replica set correctamente configurado.

## Observabilidad

Cada solicitud recibe un requestId. El logger admite solo eventos y metadatos de una lista explícita; excluye cuerpos, credenciales, direcciones y nombres de archivo. Un transporte fallido se aísla; el aviso fijo por stderr se utiliza únicamente cuando no queda ningún destino disponible.

Los archivos activos son error.log y combined.log, con rotación por tamaño. El cierre del logger drena los transportes dentro del plazo global del servidor.
