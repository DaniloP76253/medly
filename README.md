# Plataforma Distribuida para Gestión de Consultas Médicas (Medly)

Este proyecto implementa una arquitectura orientada a microservicios heterogénea y políglota para la gestión de consultas médicas:
- **Módulo A (API Gateway / Ingesta):** Node.js + Express (Puerto 8080)
- **Módulo B (Servicio de Dominio y Lógica de Negocio):** Python (FastAPI) + PostgreSQL (Puerto 5000)
- **Módulo C (Servicio de Trazabilidad y Auditoría):** Java (Spring Boot) + MongoDB (Puerto 6000)

---

## Módulo B: Servicio de Dominio y Lógica de Negocio

El **Módulo B** gestiona el ciclo de vida y la persistencia transaccional ACID de las citas médicas en PostgreSQL.

### Endpoints implementados (`app.py`):

1. **Crear una Cita Médica**:
   - `POST /api/citas` (o `/citas`)
   - **Body**:
     ```json
     {
       "paciente_id": "PAC-4412",
       "medico_id": "MED-008",
       "fecha_hora": "2026-10-20T10:30:00Z",
       "motivo": "Control general de salud"
     }
     ```
   - **Respuesta (201 Created)**: Retorna `cita_id`, estado inicial (`PENDIENTE`) y timestamp `creado_en`.
   - **Validación (400 Bad Request)**: Validación de presencia de campos obligatorios (`paciente_id`, `medico_id`, `fecha_hora`, `motivo`). La fecha y hora se recibe de manera flexible para facilitar la integración con el frontend.

2. **Cambiar el Estado de una Cita**:
   - `PATCH /api/citas/{id}/estado` (o `/citas/{id}/estado`)
   - **Body**:
     ```json
     {
       "nuevo_estado": "CONFIRMADA",
       "observacion": "Paciente confirmó asistencia vía telefónica"
     }
     ```
   - **Respuesta (200 OK)**: Retorna `cita_id`, `estado_anterior`, `estado_actual` y `actualizado_en`.
   - **Error (404 Not Found)**: Si la cita no existe.

3. **Eliminar una Cita Médica**:
   - `DELETE /api/citas/{id}` (o `/citas/{id}`)
   - **Respuesta (200 OK)**: Retorna `cita_id` y `eliminado_en`.
   - **Error (404 Not Found)**: Si la cita no existe.
   - **Regla de Negocio (409 Conflict)**: Bloquea la eliminación si la cita está en estado `COMPLETADA` o `EN_CURSO`.

---

### Ejecución Local

1. Con el entorno virtual activado:
   ```bash
   cd modulo-b
   uvicorn app:app --host 0.0.0.0 --port 5000 --reload
   ```

2. Ejecutar Pruebas:
   ```bash
   cd modulo-b
   pytest test_app.py -v
   ```

### Ejecución con Docker

Construir e iniciar la imagen:
```bash
docker build -t modulo-b ./modulo-b
docker run -p 5000:5000 --env DB_HOST=db-relacional modulo-b
```
