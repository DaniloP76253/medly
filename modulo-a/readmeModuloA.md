# Módulo A: API Gateway

Punto de entrada único de la plataforma distribuida de **Gestión de Consultas Médicas**. Valida las peticiones entrantes, las despacha al Módulo B (dominio / PostgreSQL) y notifica cada operación al Módulo C (auditoría / MongoDB).

## Tecnologías

| Componente | Tecnología |
|---|---|
| Lenguaje / Runtime | JavaScript (Node.js 20) |
| Framework web | Express 4 |
| Cliente HTTP | `fetch` nativo de Node.js |
| Hash de operación | `crypto` (SHA-256), nativo de Node.js |
| Contenedor | Docker (imagen `node:20-alpine`) |

## Requisitos

Para ejecutarlo **sin Docker**:

- Node.js 18 o superior
- npm

Para ejecutarlo **con Docker**:

- Docker
- (Opcional) Docker Compose, para levantarlo junto a los módulos B y C

Para probarlo:

- `curl` (o Postman)

### Instalación en Arch Linux

```bash
sudo pacman -S nodejs npm curl docker docker-compose docker-buildx
sudo systemctl enable --now docker.service
sudo usermod -aG docker $USER   # cerrar sesión y volver a entrar
```

## Estructura

```
modulo-a/
├── index.js        # Código del gateway (rutas, validaciones, llamadas a B y C)
├── package.json    # Dependencias y script de inicio
├── Dockerfile      # Imagen del contenedor
└── README.md
```

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto en el que escucha el gateway |
| `MODULO_B_URL` | `http://modulo-b:5000` | URL interna del Módulo B |
| `MODULO_C_URL` | `http://modulo-c:6000` | URL interna del Módulo C |

Los nombres `modulo-b` y `modulo-c` se resuelven mediante el DNS interno de la red Docker (`isolated-network`).

## Ejecución local (sin Docker)

```bash
cd modulo-a
npm install
npm start
```

Salida esperada:

```
Módulo A (API Gateway) escuchando en el puerto 8080
```

Para detenerlo: `Ctrl+C`.

Si B y C corren en tu máquina fuera de Docker, apunta el gateway a ellos:

```bash
MODULO_B_URL=http://localhost:5000 MODULO_C_URL=http://localhost:6000 npm start
```

## Ejecución con Docker

Construir la imagen:

```bash
docker build -t modulo-a .
```

Ejecutar el contenedor:

```bash
docker run --rm --name gateway -p 8080:8080 modulo-a
```

Detenerlo (desde otra terminal):

```bash
docker stop gateway
```

### Dentro de docker-compose

Fragmento para el `docker-compose.yml` del proyecto. El gateway es el único servicio que publica un puerto al host:

```yaml
modulo-a:
  build: ./modulo-a
  ports:
    - "8080:8080"
  networks:
    - isolated-network
  depends_on:
    - modulo-b
    - modulo-c
```

Los servicios de los otros módulos deben llamarse exactamente `modulo-b` y `modulo-c`.

## Endpoints

Todas las respuestas siguen el formato `{ status, codigo, mensaje, data | detalles }`.

### 1. Crear cita: `POST /api/citas`

```bash
curl -i -X POST http://localhost:8080/api/citas \
  -H "Content-Type: application/json" \
  -d '{
    "paciente_id": "PAC-4412",
    "medico_id": "MED-008",
    "fecha_hora": "2026-10-20T10:30:00Z",
    "motivo": "Control general de salud"
  }'
```

Respuesta exitosa (`201 Created`):

```json
{
  "status": "SUCCESS",
  "codigo": 201,
  "mensaje": "Cita médica creada exitosamente",
  "data": { "cita_id": "cita_98a7b6c5", "estado": "PENDIENTE", "creado_en": "2026-10-14T16:00:00Z" }
}
```

### 2. Cambiar estado: `PATCH /api/citas/{id}/estado`

Estados válidos: `PENDIENTE`, `CONFIRMADA`, `EN_CURSO`, `COMPLETADA`, `CANCELADA`.

```bash
curl -i -X PATCH http://localhost:8080/api/citas/cita_98a7b6c5/estado \
  -H "Content-Type: application/json" \
  -d '{"nuevo_estado": "CONFIRMADA", "observacion": "Paciente confirmó asistencia vía telefónica"}'
```

Respuesta exitosa (`200 OK`): incluye `cita_id`, `estado_anterior`, `estado_actual`, `actualizado_en`.

### 3. Eliminar cita: `DELETE /api/citas/{id}`

```bash
curl -i -X DELETE http://localhost:8080/api/citas/cita_98a7b6c5
```

Respuesta exitosa (`200 OK`): incluye `cita_id` y `eliminado_en`.

## Códigos de error

| Código | Cuándo ocurre | Quién lo genera |
|---|---|---|
| `400` | Payload inválido (campos faltantes, fecha no ISO 8601, estado no permitido, JSON mal formado) | Gateway |
| `404` | Cita inexistente, o ruta inexistente | Módulo B / Gateway |
| `409` | No se puede eliminar una cita `COMPLETADA` o `EN_CURSO` | Módulo B |
| `503` | El gateway no logra comunicarse con el Módulo B | Gateway |

## Flujo interno

1. El cliente envía la petición al gateway (puerto 8080).
2. El gateway valida la estructura del payload. Si es inválido, responde `400` sin llamar a otros módulos.
3. El gateway llama al Módulo B (`POST` / `PATCH` / `DELETE`). Los errores de B (404, 409) se reenvían al cliente.
4. Si B responde bien, el gateway notifica al Módulo C con la traza: `evento`, `cita_id`, `estado`, `ip_origen`, `timestamp` y `hash` (SHA-256).
5. El gateway responde al cliente con el formato del contrato.

Eventos de auditoría enviados: `CREACION`, `ACTUALIZACION_ESTADO`, `ELIMINACION`.

Si el Módulo C no responde, la operación principal **no falla**: el error solo se registra en la consola del gateway.

## Contrato esperado de los otros módulos

Rutas internas que usa el gateway (deben coincidir con las implementadas en B y C; si cambian, se editan en `index.js`):

| Módulo | Método y ruta | Respuesta esperada |
|---|---|---|
| B | `POST /citas` | `{ cita_id, estado, creado_en }` |
| B | `PATCH /citas/{id}/estado` | `{ cita_id, estado_anterior, estado_actual, actualizado_en }` |
| B | `DELETE /citas/{id}` | `{ cita_id, eliminado_en }` |
| B (errores) | cualquiera | HTTP 4xx con `{ mensaje, detalles }` |
| C | `POST /eventos` | `200 OK` |

## Solución de problemas

| Problema | Causa y solución |
|---|---|
| `permission denied ... docker.sock` | Tu usuario no está en el grupo `docker`, o no reiniciaste sesión. Ejecuta `sudo usermod -aG docker $USER` y vuelve a iniciar sesión (o usa `newgrp docker`). |
| `port is already allocated` / `EADDRINUSE` | El puerto 8080 está ocupado. Revisa con `docker ps` y `ss -tlnp \| grep 8080`, y detén el proceso con `docker stop <id>`. |
| `Cannot connect to the Docker daemon` | Docker no está encendido: `sudo systemctl start docker`. |
| Respuesta `503` al crear una cita | Normal si el Módulo B no está levantado. Verifica que `modulo-b` esté en la misma red Docker. |
