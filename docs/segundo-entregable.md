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
Además, HAProxy reintenta en el nodo alternativo cuando una conexión falla, lo
que evita exponer un error mientras termina la detección del health check.

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

## 3. Blueprint del informe de pruebas de estrés y caos

Esta sección define cómo ejecutar y documentar las pruebas. Los campos marcados
como **[Completar]** deben reemplazarse con los valores obtenidos; no representan
resultados anticipados. Todas las pruebas deben ejecutarse sobre el mismo equipo
y con la misma versión del código para que la comparación sea válida.

### 3.1 Configuración del entorno

| Elemento | Valor utilizado |
|---|---|
| Equipo y sistema operativo | **[Completar]** |
| Procesador y memoria disponible | **[Completar]** |
| Docker y Docker Compose | **[Completar versiones]** |
| Herramienta de carga | k6 **[Completar versión]** |
| URL probada | `http://localhost:8081` |
| Fecha y hora de ejecución | **[Completar]** |
| Commit o versión del proyecto | **[Completar]** |

Antes de cada escenario se debe levantar el entorno desde un estado conocido:

```sh
docker compose up --build -d
docker compose ps
```

Si existe un volumen de PostgreSQL es necesario un reinicio limpio

```sh
docker compose down -v
docker compose up --build -d
```

Se propone el siguiente perfil común de carga. Puede reducirse si el equipo no
dispone de recursos suficientes, pero debe mantenerse idéntico en todos los
escenarios comparados:

| Etapa | Duración | Usuarios virtuales |
|---|---:|---:|
| Subida gradual | 30 segundos | 0 a 20 |
| Carga sostenida | 2 minutos | 20 |
| Descenso | 30 segundos | 20 a 0 |

La operación principal será `POST /api/citas`, utilizando identificadores y
fechas variables para evitar conflictos entre solicitudes. Las métricas mínimas
serán solicitudes por segundo, latencia promedio, p95, p99 y tasa de errores.

### 3.2 Escenario 0: línea base

**Objetivo:** establecer el comportamiento normal del sistema y comprobar que
HAProxy distribuye solicitudes entre `gateway-a1` y `gateway-a2`.

**Preparación:** verificar que todos los servicios estén saludables y que ambos
gateways aparezcan en ejecución.

**Procedimiento:**

1. Ejecutar el perfil de carga completo sin detener contenedores.
2. Guardar el resumen generado por k6.
3. Realizar varias consultas a `/health` y registrar los valores de
   `X-Node-Id` para demostrar la alternancia.
4. Capturar `docker compose ps` y los logs de HAProxy.

**Resultados:**

| TPS promedio | Latencia promedio | p95 | p99 | Error |
|---:|---:|---:|---:|---:|
| **[Completar]** | **[Completar]** | **[Completar]** | **[Completar]** | **[Completar]** |

**Evidencias:**

- Captura del resumen k6: **[Insertar imagen o enlace]**.
- Captura de los dos identificadores de gateway: **[Insertar imagen]**.
- Observaciones: **[Completar]**.

### 3.3 Escenario 1: caída de un gateway

**Objetivo:** medir si HAProxy retira automáticamente un gateway caído y cuánto
tarda el sistema en continuar operando exclusivamente con el nodo restante.

**Falla inyectada:** durante la etapa de carga sostenida, ejecutar:

```sh
docker stop medly-gateway-a1
```

Para reincorporar el nodo después de la medición:

```sh
docker start medly-gateway-a1
```

**Procedimiento:**

1. Iniciar la carga y anotar la hora exacta de inicio.
2. Detener `gateway-a1` durante la carga sostenida y anotar la hora.
3. Mantener la carga durante al menos 30 segundos adicionales.
4. Registrar cuándo dejan de aparecer errores y cuándo HAProxy marca el nodo
   como no disponible.
5. Iniciar nuevamente el gateway y observar su reincorporación.

**Resultados:**

| TPS promedio | p95 | p99 | Error | RTO observado |
|---:|---:|---:|---:|---:|
| **[Completar]** | **[Completar]** | **[Completar]** | **[Completar]** | **[Completar]** |

**Análisis que debe completar el ejecutor:**

- Cantidad de solicitudes fallidas durante la detección: **[Completar]**.
- Comportamiento de las solicitudes posteriores: **[Completar]**.
- Tiempo de retiro y reincorporación del nodo: **[Completar]**.
- Comparación con la línea base: **[Completar]**.
- Evidencia de k6 y logs HAProxy: **[Insertar imágenes]**.

### 3.4 Escenario 2: caída del primario MongoDB

**Objetivo:** verificar la elección automática de un nuevo primario y observar
el impacto sobre el registro de auditoría.

**Preparación:** identificar el primario actual:

```sh
docker compose exec mongo-1 mongosh --quiet --eval "rs.status().members.map(m => ({name:m.name,state:m.stateStr}))"
```

**Falla inyectada:** detener el contenedor identificado como `PRIMARY`. Por
ejemplo, si el primario es `mongo-1`:

```sh
docker stop medly-mongo-1
```

**Procedimiento:**

1. Iniciar la carga y confirmar que se generan eventos de auditoría.
2. Detener el primario y anotar la hora exacta.
3. Consultar el estado desde uno de los nodos activos hasta observar un nuevo
   `PRIMARY`.
4. Mantener la carga durante 30 segundos y comprobar que vuelven a registrarse
   eventos.
5. Reiniciar el nodo detenido al finalizar.

**Resultados:**

| Tiempo de elección | Solicitudes API fallidas | Auditorías esperadas | Auditorías registradas | Pérdida observada |
|---:|---:|---:|---:|---:|
| **[Completar]** | **[Completar]** | **[Completar]** | **[Completar]** | **[Completar]** |

**Análisis que debe completar el ejecutor:**

- Nuevo nodo primario: **[Completar]**.
- Efecto de `retryWrites` y `writeConcern=majority`: **[Completar]**.
- Errores transitorios observados: **[Completar]**.
- Evidencias del Replica Set antes y después: **[Insertar imágenes]**.

### 3.5 Escenario 3: verificación del particionamiento

**Objetivo:** comprobar que las citas se almacenan en las cuatro particiones de
PostgreSQL. Esta es una verificación funcional, no una prueba de failover.

Después de generar suficientes citas, ejecutar:

```sh
docker compose exec db-relacional psql -U postgres -d citas_db -c \
  "SELECT tableoid::regclass AS particion, COUNT(*) AS filas FROM citas GROUP BY tableoid ORDER BY particion;"
```

**Resultados:**

| Partición | Cantidad de filas |
|---|---:|
| `citas_p0` | **[Completar]** |
| `citas_p1` | **[Completar]** |
| `citas_p2` | **[Completar]** |
| `citas_p3` | **[Completar]** |

**Evidencia y análisis:** **[Insertar captura y explicar si la distribución fue
razonablemente uniforme]**.

### 3.6 Resumen comparativo

Esta tabla debe completarse al terminar todos los escenarios:

| Escenario | Falla inyectada | TPS | p95 | p99 | Error | RTO |
|---|---|---:|---:|---:|---:|---:|
| Línea base | Ninguna | **[ ]** | **[ ]** | **[ ]** | **[ ]** | N/A |
| Caída de gateway | `gateway-a1` detenido | **[ ]** | **[ ]** | **[ ]** | **[ ]** | **[ ]** |
| Caída de MongoDB | Primario detenido | **[ ]** | **[ ]** | **[ ]** | **[ ]** | **[ ]** |

### 3.7 Hallazgos y plan de mejora

- Principal cuello de botella observado: **[Completar]**.
- Componente que alcanzó mayor uso de recursos: **[Completar]**.
- Diferencia más relevante respecto de la línea base: **[Completar]**.
- Acción correctiva propuesta: **[Completar]**.
- Limitaciones de la prueba: **[Completar]**.

