# Medly — Plataforma de Gestión de Consultas Médicas

Arquitectura de microservicios heterogénea con 3 módulos:

| Módulo | Tecnología | Puerto |
|--------|-----------|--------|
| **A** — API Gateway | Node.js + Express | `8080` |
| **B** — Servicio de Dominio | Python + FastAPI | `5000` |
| **DB** — Base de Datos | PostgreSQL 16 | `5432` |

---

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) corriendo

---

## Levantar el proyecto

```bash
docker compose up --build
```

La primera vez descarga las imágenes y construye los contenedores (~1-2 min).  
Las siguientes veces sin cambios de código:

```bash
docker compose up
```

Para correr en segundo plano:

```bash
docker compose up --build -d
```

Para detener todo:

```bash
docker compose down
```

> Los datos de PostgreSQL persisten en el volumen `pgdata`. Para borrarlos también:
> ```bash
> docker compose down -v
> ```

---

## Verificar que todo funciona

Una vez levantado, abre en tu navegador o usa `curl`:

```
GET http://localhost:5000/health   →  { "status": "UP" }
```

---

## Endpoints disponibles

Todas las requests van al **gateway en el puerto 8080**:

### 1. Crear cita médica
```
POST http://localhost:8080/api/citas
Content-Type: application/json

{
  "paciente_id": "PAC-4412",
  "medico_id":   "MED-008",
  "fecha_hora":  "2026-10-25T10:30:00Z",
  "motivo":      "Control general de salud"
}
```

### 2. Cambiar estado de una cita
```
PATCH http://localhost:8080/api/citas/{cita_id}/estado
Content-Type: application/json

{
  "nuevo_estado": "CONFIRMADA",
  "observacion":  "Paciente confirmó por teléfono"
}
```
Estados válidos: `PENDIENTE` · `CONFIRMADA` · `EN_CURSO` · `COMPLETADA` · `CANCELADA`

### 3. Eliminar una cita
```
DELETE http://localhost:8080/api/citas/{cita_id}
```
> No se puede eliminar una cita en estado `COMPLETADA` o `EN_CURSO`.

---

## Consultar la base de datos

Para ver las citas directamente en PostgreSQL:

```bash
docker exec -it medly-db-relacional psql -U postgres -d citas_db -c \
  "SELECT cita_id, paciente_id, estado, creado_en FROM citas ORDER BY creado_en DESC;"
```

---

## Estructura del proyecto

```
medly/
├── docker-compose.yml     ← orquestación de todos los contenedores
├── modulo-a/              ← API Gateway (Node.js)
│   ├── index.js
│   └── Dockerfile
└── modulo-b/              ← Servicio de Dominio (FastAPI)
    ├── app.py
    ├── requirements.txt
    └── Dockerfile
```
