# Segundo entregable — Medly

## 1. Introducción y arquitectura extendida

### 1.1 Propósito del sistema

Medly es una plataforma distribuida para la gestión de consultas médicas. El
sistema permite crear citas, modificar su estado, eliminarlas y conservar una
traza de auditoría de las operaciones realizadas. La solución separa la lógica
transaccional de las citas, almacenada en PostgreSQL, de los eventos de
auditoría, almacenados en MongoDB.

En esta etapa se extiende la arquitectura original para mejorar la
disponibilidad y permitir que el sistema continúe atendiendo solicitudes cuando
una instancia del API Gateway deja de responder. Como objetivo inicial de la
demostración se espera que, ante la caída de uno de los dos gateways, el servicio
permanezca disponible a través de la instancia restante. Los tiempos de
recuperación, la latencia y la tasa de errores se medirán posteriormente mediante
pruebas de carga y fallos controlados.

### 1.2 Arquitectura extendida

La arquitectura extendida incorpora HAProxy como único punto de entrada a la
API. HAProxy distribuye las solicitudes entre dos instancias sin estado del
Módulo A y verifica periódicamente su disponibilidad. Ambos gateways consumen
los mismos servicios internos, por lo que una petición puede ser atendida por
cualquiera de ellos sin depender de información almacenada localmente.

El Módulo B conserva la lógica de negocio y utiliza PostgreSQL para almacenar
las citas médicas. La tabla de citas se divide mediante particionamiento hash.
El Módulo C registra los eventos de auditoría en un Replica Set de MongoDB de
tres miembros, compuesto por un nodo primario y dos secundarios.

[Ver código PlantUML de la topología extendida](diagramas/arquitectura-simple.puml).

El diagrama representa dos zonas de disponibilidad lógicas para mostrar la
distribución de los componentes. En el entorno de la entrega ambas zonas se
simulan mediante contenedores ejecutados en un mismo computador; no equivalen a
dos centros de datos ni protegen frente a la caída completa del host.

Los componentes de la solución son los siguientes:

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| HAProxy | HAProxy | Punto de entrada, balanceo y detección de gateways caídos. |
| Módulo A | Node.js y Express | Validación, enrutamiento y coordinación de las solicitudes. |
| Módulo B | Python y FastAPI | Reglas de negocio y gestión de citas médicas. |
| PostgreSQL | PostgreSQL 16 | Persistencia transaccional y particionamiento de citas. |
| Módulo C | Java y Spring Boot | Registro y consulta de eventos de auditoría. |
| MongoDB | Replica Set de tres nodos | Persistencia replicada de la auditoría. |
| Docker Compose | Docker | Ejecución y red interna de los contenedores. |

HAProxy será el único servicio de la API publicado para los clientes. Los
gateways y los demás componentes se comunicarán por nombres de servicio dentro
de la red de Docker, sin utilizar direcciones IP fijas. El frontend podrá seguir
publicándose de manera independiente para la demostración visual.

## 2. Alta disponibilidad y escalabilidad

La estrategia se concentra en mecanismos pequeños y comprobables. La
disponibilidad de la aplicación se obtiene mediante dos gateways y la exclusión
automática de instancias no saludables. La disponibilidad de la auditoría se
apoya en la replicación nativa de MongoDB. Para el crecimiento de los datos se
implementa particionamiento en PostgreSQL y se define una estrategia futura de
sharding para MongoDB.

### 2.1 Balanceo de carga y enrutamiento

#### Tecnología implementada

Se utilizará HAProxy como proxy inverso y balanceador de carga. Los clientes
enviarán todas las solicitudes a una sola dirección y HAProxy seleccionará una
de las dos instancias del API Gateway:

- `gateway-a1`.
- `gateway-a2`.

Cada gateway incluirá un identificador de nodo en la cabecera `X-Node-Id`. Esta
cabecera permitirá verificar durante las pruebas que las solicitudes fueron
atendidas por instancias diferentes.

#### Algoritmo seleccionado

El algoritmo será **Round Robin**. HAProxy enviará cada nueva solicitud al
siguiente gateway disponible de manera alternada.

Round Robin es apropiado porque las instancias ejecutan el mismo código, tienen
recursos equivalentes y no conservan sesiones locales. Las operaciones de la API
presentan un costo similar y cualquier gateway puede atenderlas. Por estas
razones no es necesario incorporar afinidad de sesión ni ponderaciones distintas.

#### Comprobaciones de salud

HAProxy consultará el endpoint HTTP `/health` de cada gateway. La configuración
inicial propuesta es:

| Parámetro | Valor inicial |
|---|---:|
| Protocolo | HTTP |
| Endpoint | `/health` |
| Intervalo de comprobación | 2 segundos |
| Timeout de conexión | 2 segundos |
| Fallos para retirar un nodo | 3 |
| Éxitos para reincorporarlo | 2 |

Estos valores son parámetros iniciales y podrán modificarse después de las
pruebas. Con tres fallos consecutivos, el tiempo teórico de detección será de
aproximadamente seis segundos, además del tiempo consumido por los timeouts.

### 2.2 Failover automático y replicación

#### Failover de la capa de aplicación

El failover automático se implementará en HAProxy. Cuando un gateway no responda
a las comprobaciones de salud, será marcado como no disponible y retirado del
conjunto de servidores. Las solicitudes nuevas se enviarán exclusivamente al
gateway saludable. Cuando el nodo vuelva a responder de forma estable, HAProxy
lo incorporará nuevamente.

Este mecanismo mantiene disponibles las solicitudes nuevas, pero no garantiza
que una petición que estaba siendo procesada en el instante exacto de la caída
finalice correctamente. El cliente podría recibir un error transitorio y deberá
reintentar la operación cuando corresponda.

#### Replicación de MongoDB

La base de auditoría utilizará un Replica Set con tres miembros:

- Un nodo primario, encargado de recibir las escrituras.
- Dos nodos secundarios, que mantienen copias de los eventos.

Si el primario deja de estar disponible, los miembros restantes realizan una
elección y uno de los secundarios elegibles asume el rol de primario. El Módulo
C utilizará una cadena de conexión que incluya los miembros del Replica Set y
las opciones `retryWrites=true` y `writeConcern=majority`.

`writeConcern=majority` permite considerar confirmada una escritura cuando la
mayoría de los miembros la ha aceptado. Esto reduce el riesgo de perder eventos
confirmados durante una elección, aunque puede aumentar la latencia respecto de
una confirmación realizada únicamente por el primario.

El failover del Replica Set es independiente del failover de los gateways. La
caída de un gateway es resuelta por HAProxy, mientras que la caída del primario
de auditoría es gestionada por MongoDB y su controlador de conexión.

#### Prevención de split-brain

MongoDB utiliza la mayoría de votos del Replica Set para elegir un primario. Si
un grupo aislado no reúne la mayoría, no puede mantener o elegir un nodo primario
capaz de confirmar escrituras. En un conjunto de tres miembros se necesitan al
menos dos miembros comunicados para realizar una elección válida.

### 2.3 Particionamiento y sharding

#### Particionamiento de PostgreSQL

La tabla `citas` se implementará utilizando particionamiento declarativo por
hash sobre `cita_id`, con cuatro particiones iniciales:

- `citas_p0`.
- `citas_p1`.
- `citas_p2`.
- `citas_p3`.

PostgreSQL calculará el hash de `cita_id` y dirigirá cada fila a la partición
correspondiente. Se eligió esta clave porque identifica de forma única cada cita
y sus valores se generan de manera uniforme, lo que ayuda a repartir las filas
sin concentrarlas por médico, paciente o fecha.

La estrategia también permite que las consultas por `cita_id` sean dirigidas a
la partición correspondiente. Las consultas globales, como listar las citas más
recientes, pueden consultar más de una partición; por ello deberán mantenerse
acotadas y paginadas.

El número de particiones no se modificará automáticamente durante esta entrega.
Si el volumen creciera, el reequilibrio requeriría crear una nueva tabla
particionada y migrar los datos de forma controlada. Cuatro particiones son
suficientes para demostrar el concepto sin añadir complejidad innecesaria.

#### Estrategia de sharding para MongoDB

El sharding se presenta como diseño de escalabilidad futura y no como parte del
despliegue local. La colección candidata será `eventos_auditoria` y la shard key
propuesta será:

```javascript
{ citaId: "hashed" }
```

La clave `citaId` permite que los eventos relacionados con una cita sean
consultados mediante el identificador conocido. Su transformación hash ayuda a
distribuir las escrituras y evita que identificadores cercanos o eventos
generados en el mismo periodo se concentren en un solo shard.

En un clúster fragmentado futuro, MongoDB dividiría los datos en chunks y su
balancer podría moverlos entre shards para mantener una distribución uniforme.
Las consultas globales de auditoría podrían involucrar múltiples shards, por lo
que deberían emplear filtros, rangos de fecha y paginación.

La diferencia entre ambos mecanismos es importante: las cuatro particiones de
PostgreSQL se implementarán dentro de una misma instancia, mientras que el
sharding de MongoDB se documenta como una distribución futura entre servidores.

