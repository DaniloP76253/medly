# Arquitectura extendida de Medly

## Alcance

Esta es la arquitectura objetivo propuesta para alta disponibilidad y crecimiento.
El Compose actual se mantiene como entorno local de demostración: levanta una
instancia de cada módulo y una instancia de cada base de datos. El panel muestra
esa diferencia para no presentar las réplicas o los failovers propuestos como si
ya estuvieran desplegados.

## Topología propuesta

[Diagrama PlantUML: topología extendida](diagramas/arquitectura-ha.puml)

- **Borde y frontend:** dos proxies HAProxy con Keepalived y una IP virtual
  distribuyen las peticiones entre dos instancias estáticas del frontend y dos
  gateways. El proxy usa round robin y health checks HTTP; saca del pool un nodo
  que no responda.
- **Aplicación:** dos gateways, tres instancias del módulo B y tres del módulo C.
  Los módulos no guardan estado de sesión en disco o memoria local. Los archivos
  estáticos del frontend tampoco guardan estado.
- **PostgreSQL:** tres nodos gestionados por Patroni y un clúster etcd de tres
  miembros. El modo síncrono protege las transacciones confirmadas frente a la
  caída de un primario, con el costo de detener escrituras si no hay una réplica
  síncrona disponible. Un par HAProxy/Keepalived ofrece endpoints estables para
  escritura al primario y lectura a réplicas.
- **MongoDB:** dos routers `mongos`, un Replica Set de tres miembros para la
  configuración del clúster y dos shards, cada uno respaldado por un Replica Set
  de tres miembros. El driver de C recibe ambos routers como semillas y usa
  `retryWrites=true` y `writeConcern=majority`.
- **Redes:** frontend, servicios y datos se separan en redes virtuales. El
  navegador llega al VIP; solo el proxy conoce los servicios frontend/API, y
  solo los módulos llegan a las redes de datos.

## Escalabilidad de datos

[Diagrama PlantUML: particionamiento de datos](diagramas/particionamiento-datos.puml)

- PostgreSQL particiona `citas` con `HASH(cita_id)` en ocho particiones. La
  clave primaria `cita_id` contiene la clave de partición y conserva unicidad
  entre las particiones.
- MongoDB distribuye `eventos_auditoria` con shard key `{ citaId: "hashed" }`.
  Las búsquedas por cita se enrutan por clave; las consultas globales recientes
  requieren agregación entre shards y deben limitarse por fecha/paginación.

## Flujos y tolerancia a fallos

[Diagrama PlantUML: flujo del panel](diagramas/flujo-dashboard.puml)

[Diagrama PlantUML: conmutación por error](diagramas/failover-datos.puml)

El frontend solo llama al gateway. Las respuestas incluyen identificadores de
nodo (`X-Node-Id`, `X-Domain-Node`, `X-Audit-Node`), y cada evento de auditoría
guarda los nodos gateway, dominio y auditoría en `detalleOperacion`. Así el panel
puede atribuir una operación histórica sin asumir que todas las instancias son
la misma.

Si una réplica de aplicación falla, los health checks del proxy la retiran y las
nuevas peticiones pasan a otra réplica. Si falla el primario PostgreSQL, Patroni
elige una réplica elegible con ayuda del quorum etcd y el proxy SQL cambia el
destino de escritura; los módulos conservan el mismo endpoint. Ante una elección
MongoDB, el driver vuelve a seleccionar el primario del shard. Las peticiones
con resultado ambiguo deben reintentarse con una clave de idempotencia para no
crear citas duplicadas.

## Prototipo incluido

El panel está en `frontend/` y se publica en `http://localhost:3000`. Sirve para:

- Registrar una cita o una ráfaga controlada de 2 a 20 citas.
- Consultar las citas activas en PostgreSQL y sus eventos en MongoDB.
- Ver el estado de los módulos, las bases de datos y los identificadores de nodo.
- Ver eventos de failover reportados por el entorno; el Compose local no dispone
  de un coordinador de failover, así que no genera eventos de conmutación.

El backend expone `GET /api/citas` para la lista y `GET /api/dashboard/health`
para el resumen de salud. El endpoint de salud del módulo B verifica la conexión
SQL y el del módulo C ejecuta `ping` contra MongoDB. Las réplicas, proxies
redundantes, clústeres y particionamiento de la arquitectura objetivo aún deben
implementarse y probarse antes del entregable final.

## Decisiones para la siguiente etapa

1. Desplegar cada réplica en un host/nodo distinto; varias réplicas en un único
   host Docker no eliminan la falla del host.
2. Añadir claves de idempotencia y retries con backoff en las llamadas de
   escritura, y documentar timeouts/circuit breaker.
3. Medir RTO/RPO, latencia p95/p99, TPS y tasa HTTP 5xx en escenarios de caída,
   pérdida de red y carga sostenida.
4. Ajustar el número de particiones y shards con datos de carga, y automatizar
   el aprovisionamiento de volúmenes por nodo.

Como objetivos iniciales de diseño —todavía no medidos— se propone recuperar el
servicio de aplicación en menos de 10 s y el primario PostgreSQL en menos de
30 s. Para escrituras confirmadas, la replicación síncrona busca RPO 0 ante la
caída de un nodo; estos objetivos deben validarse con pruebas de caos y carga.

Para exportar los diagramas a SVG con PlantUML instalado:

```sh
plantuml -tsvg docs/diagramas/*.puml
```
