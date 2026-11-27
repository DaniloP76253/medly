# Medly — Entrega parcial de arquitectura HA y frontend

Este documento reúne los cambios del prototipo de interfaz y la propuesta de
arquitectura extendida. El [README principal](README.md) conserva las
instrucciones generales del proyecto.

## Estado de la entrega

El repositorio contiene una implementación académica de alta disponibilidad:
HAProxy distribuye las peticiones entre dos gateways, MongoDB utiliza un Replica
Set de tres nodos y PostgreSQL almacena las citas en cuatro particiones hash.
Todo se ejecuta en un único host, por lo que las zonas de disponibilidad del
informe son lógicas y no protegen frente a la caída completa del computador.

## Inicio rápido

Requisitos: Docker Engine y Docker Compose v2.

Desde la raíz del proyecto:

```sh
docker compose up --build -d
docker compose ps
```

Si ya se ejecutó una versión anterior, el servicio `db-init` migra la tabla
existente sin borrar sus filas: conserva la tabla original como
`citas_legacy`, crea `citas` particionada y copia los registros. El comando
`docker compose down -v` solo debe usarse cuando se quiera borrar de forma
intencional toda la información local.

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
Nginx. Nginx sirve la SPA en el puerto `3000` y reenvía las llamadas `/api` a
HAProxy dentro de la red Docker, así el navegador usa un único origen.

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
- **Failover:** HAProxy retira un gateway que falle sus comprobaciones HTTP y
  continúa enviando tráfico al gateway saludable.

El Replica Set de MongoDB realiza la elección de un nuevo primario si el nodo
actual deja de estar disponible y conserva las escrituras con confirmación de
mayoría.

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

## Arquitectura implementada y evolución futura

La explicación vigente se encuentra en
[`docs/segundo-entregable.md`](docs/segundo-entregable.md). El Compose implementa
un HAProxy, dos gateways sin estado, un módulo de dominio, un módulo de auditoría,
PostgreSQL con cuatro particiones y un Replica Set MongoDB de tres miembros. El
sharding de auditorías mediante `{ citaId: "hashed" }` se mantiene como diseño
futuro y no se presenta como una característica desplegada.

## Diagramas PlantUML

El diagrama requerido para el informe es
[`arquitectura-simple.puml`](docs/diagramas/arquitectura-simple.puml). Incluye
clientes, balanceador, aplicaciones sin estado, bases de datos y zonas lógicas.

Con PlantUML instalado, se pueden exportar a SVG así:

```sh
plantuml -tsvg docs/diagramas/*.puml
```

## Alcance pendiente

Queda ejecutar los blueprints incluidos en el informe y completar TPS, latencia
p95/p99, errores y RTO con resultados reales. El sharding físico de MongoDB no
forma parte de esta entrega.
