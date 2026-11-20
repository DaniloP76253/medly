# Medly — Entrega parcial de arquitectura HA y frontend

Este documento reúne los cambios del prototipo de interfaz y la propuesta de
arquitectura extendida. El [README principal](README.md) conserva las
instrucciones generales del proyecto.

## Estado de la entrega

El repositorio contiene una SPA que consulta los servicios actuales y
una propuesta documentada de alta disponibilidad, particionamiento y failover.
El `docker-compose.yml` local aún levanta **una instancia de cada servicio y una
instancia de cada base de datos**. La topología HA de los diagramas es el diseño
objetivo; no está desplegada en este Compose.

## Inicio rápido

Requisitos: Docker Engine y Docker Compose v2.

Desde la raíz del proyecto:

```sh
docker compose up --build -d
docker compose ps
```

Abre el panel en <http://localhost:3000>. El gateway también está publicado en
<http://localhost:8081> para consultas directas.

Para detener el stack sin borrar los datos:

```sh
docker compose down
```

Para reiniciar las bases de datos desde cero y borrar sus volúmenes:

```sh
docker compose down -v
```

## Qué ofrece el frontend

El frontend está en [`frontend/`](frontend/) y usa HTML, CSS, JavaScript y
Nginx. Nginx sirve la SPA en el puerto `3000` y reenvía las llamadas `/api` al
gateway dentro de la red Docker, así el navegador usa un único origen.

- **Registro de citas:** formulario para crear una cita individual.
- **Ráfagas:** permite enviar entre 2 y 20 citas concurrentes. El sistema indica
  cuántas se crearon correctamente y cuántas fallaron.
- **Transacciones:** lista las citas recientes y permite cambiar su estado o
  eliminarlas. Cada cita de la tabla puede seleccionarse para completar el
  formulario de gestión.
- **Auditoría:** lista eventos persistidos en MongoDB y permite consultar todos
  los eventos, filtrar por cita, tipo de operación o rango de fechas. Incluye un
  formulario manual para invocar el registro de eventos, útil en demostraciones.
- **Salud:** consulta el gateway, los módulos B y C, PostgreSQL y MongoDB; se
  actualiza cada 12 segundos, se puede actualizar manualmente y tiene una
  comprobación individual para cada servicio.
- **Failover:** muestra los eventos reportados por el backend. El stack local no
  tiene coordinador de failover, por lo que actualmente informa cero eventos.

La interfaz distingue el estado real del Compose local de la arquitectura HA
propuesta.

## Cambios en el backend para el panel

### Endpoints nuevos o extendidos

Todas las llamadas del navegador pasan por Nginx y el gateway, bajo el prefijo
`/api`. Los botones de comprobación llaman a las rutas individuales de salud;
el panel también consulta el endpoint agregado.

| Método | Ruta relativa al gateway | Función disponible en el frontend |
|---|---|---|
| `GET` | `/health/gateway` | Comprobar el estado del gateway. |
| `GET` | `/health/dominio` | Comprobar el módulo B y su base de datos. |
| `GET` | `/health/auditoria` | Comprobar el módulo C y MongoDB. |
| `GET` | `/dashboard/health` | Ver salud agregada de servicios y bases de datos. |
| `GET` | `/citas` | Listar citas recientes. |
| `POST` | `/citas` | Crear una cita individual o enviar una ráfaga de citas. |
| `PATCH` | `/citas/{id}/estado` | Cambiar el estado de una cita. |
| `DELETE` | `/citas/{id}` | Eliminar una cita, previa confirmación. |
| `GET` | `/auditoria/eventos` | Consultar todos los eventos. |
| `GET` | `/auditoria/eventos/cita/{citaId}` | Filtrar eventos por cita. |
| `GET` | `/auditoria/eventos/tipo/{tipoOperacion}` | Filtrar por creación, actualización o eliminación. |
| `GET` | `/auditoria/eventos/rango?desde=…&hasta=…` | Filtrar por fechas. |
| `POST` | `/auditoria/eventos` | Registrar manualmente un evento de auditoría. |

Las operaciones normales de cita también generan automáticamente un evento de
auditoría desde el gateway. El registro manual está disponible para probar el
endpoint de auditoría y puede generar eventos que no correspondan a una
transacción real de cita.

El endpoint de Módulo A `GET /health` permanece disponible para comprobaciones
externas, y Nginx responde `GET /health` en el puerto del frontend. En la
interfaz, la comprobación individual del gateway usa `/api/health/gateway`.

### Identificación de los nodos

Las respuestas de A, B y C incluyen `X-Node-Id`. El gateway reenvía el nodo de
dominio como `X-Domain-Node` y el nodo de auditoría como `X-Audit-Node` en las
consultas respectivas. Al crear, actualizar o eliminar una cita, el gateway
guarda estos datos en el documento de auditoría:

```json
{
  "nodoGateway": "...",
  "nodoDominio": "...",
  "nodoAuditoria": "..."
}
```

Los eventos antiguos que no tengan estos campos se muestran sin identificador
de nodo.

### Comprobaciones manuales

```sh
curl http://localhost:3000/health
curl http://localhost:8081/health
curl http://localhost:8081/api/dashboard/health
curl http://localhost:8081/api/health/gateway
curl http://localhost:8081/api/health/dominio
curl http://localhost:8081/api/health/auditoria
curl http://localhost:8081/api/citas
curl http://localhost:8081/api/auditoria/eventos
```

## Arquitectura objetivo

La explicación completa y las decisiones están en
[`docs/arquitectura-ha.md`](docs/arquitectura-ha.md). En resumen, el diseño
propone:

- Dos proxies de borde con HAProxy y Keepalived detrás de una IP virtual, más
  dos instancias del frontend y dos del gateway.
- Tres instancias stateless de los módulos B y C.
- PostgreSQL con Patroni, tres nodos, etcd con quorum de tres miembros y un par
  HAProxy/Keepalived para mantener endpoints de lectura y escritura.
- MongoDB sharded: dos `mongos`, Replica Set de tres nodos para configuración y
  dos shards, cada uno como Replica Set de tres nodos.
- Redes separadas para frontend, servicios y datos.
- Particionamiento PostgreSQL con `HASH(cita_id)` en ocho particiones y
  particionamiento MongoDB con shard key `{ citaId: "hashed" }`.

El modo síncrono PostgreSQL busca RPO 0 para las escrituras confirmadas ante la
caída de un nodo, con la consecuencia de que las escrituras pueden detenerse si
no queda una réplica síncrona disponible. Como objetivos iniciales a validar se
propusieron RTO menor a 10 segundos para recuperación de una réplica de
aplicación y menor a 30 segundos para la elección del primario PostgreSQL. Son
metas de diseño, no métricas medidas.

## Diagramas PlantUML

Los fuentes están en [`docs/diagramas/`](docs/diagramas/):

1. [`arquitectura-ha.puml`](docs/diagramas/arquitectura-ha.puml): servicios,
   redes, balanceadores y clústeres propuestos.
2. [`particionamiento-datos.puml`](docs/diagramas/particionamiento-datos.puml):
   particiones PostgreSQL y shards MongoDB.
3. [`flujo-dashboard.puml`](docs/diagramas/flujo-dashboard.puml): consultas del
   panel, escritura de citas y persistencia de auditoría.
4. [`failover-datos.puml`](docs/diagramas/failover-datos.puml): retiro de una
   réplica de aplicación y conmutación de las bases de datos.

Con PlantUML instalado, se pueden exportar a SVG así:

```sh
plantuml -tsvg docs/diagramas/*.puml
```

## Alcance pendiente del proyecto final

La entrega actual no configura réplicas, balanceadores, Patroni, MongoDB
sharding ni failover automático. Tampoco incluye resultados de ingeniería del
caos o pruebas de carga. Para el proyecto final queda implementar esa topología
y documentar los escenarios con medidas reales de RTO/RPO, latencia p95/p99,
TPS, errores HTTP y recuperación. El script [`test-containers.sh`](test-containers.sh)
continúa cubriendo el flujo base de integración y persistencia.
