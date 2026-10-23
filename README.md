# Medly - Plataforma de gestión de consultas médicas

Medly es una arquitectura de microservicios compuesta por un gateway, un servicio de dominio y un servicio de auditoría. El proyecto utiliza PostgreSQL para las citas y MongoDB Atlas Local para la trazabilidad.

## Arquitectura y puertos

|   |   |   |   |
|---|---|---|---|
|**Componente**|**Tecnología**|**Puerto dentro de Docker**|**Puerto en el host**|
|Módulo A - API Gateway|Node.js + Express|`8080`|`8081`|
|Módulo B - Servicio de dominio|Python + FastAPI|`5000`|`5000`|
|Módulo C - Auditoría|Java 17 + Spring Boot|`6001`|`6000`|
|PostgreSQL|PostgreSQL 16|`5432`|`5433`|
|MongoDB|MongoDB Atlas Local|`27017`|`27017`|

El gateway es el punto de entrada recomendado para las operaciones de citas: `http://localhost:8081`. Los puertos internos son los que utilizan los contenedores para comunicarse entre sí.

## Requisitos

Para ejecutar el sistema completo:

- Docker Engine o Docker Desktop en ejecución.
    
- Docker Compose v2 (`docker compose`).
    
- Bash y `curl` para ejecutar los scripts de prueba.
    

Para ejecutar pruebas del módulo C fuera de Docker:

- Java 17.
    
- Maven 3.9 o posterior.
    
- Una instancia accesible de MongoDB, o las variables de conexión configuradas en `modulo-c/src/main/resources/application.yml`.
    

## Ejecución recomendada con Docker Compose

Desde la raíz del repositorio:

```
docker compose config -q
docker compose up --build -d
```

Compose inicia los servicios en el orden necesario: primero las bases de datos, después el módulo B y el módulo C, y finalmente el módulo A. Las comprobaciones de salud evitan que un servicio dependiente se inicie antes de tiempo.

Para ver el estado de los servicios:

```
docker compose ps
```

Para seguir los logs:

```
docker compose logs -f modulo-a modulo-b modulo-c
```

Para detener los contenedores sin eliminar los datos:

```
docker compose down
```

Para detenerlos y borrar también los volúmenes persistentes (reinicio completo de PostgreSQL y MongoDB):

```
docker compose down -v
```

> La primera ejecución puede tardar porque construye las imágenes y descarga PostgreSQL, MongoDB, Node.js, Python y Java.

## Comprobación de salud

Ejecuta estas comprobaciones después de que `docker compose ps` muestre los servicios como `healthy`:

```
curl http://localhost:5000/health
curl http://localhost:6000/api/auditoria/health
curl -i http://localhost:8081/api/citas
```

Las dos primeras deben responder correctamente. La última debe devolver `404` porque se está consultando una ruta no existente sin usar un método de negocio; esa respuesta confirma que el gateway está disponible.

## Prueba automática del flujo completo

El script de integración construye y levanta todo el stack, espera a que los cinco servicios estén saludables y prueba el flujo:

1. Crear una cita mediante el módulo A.
    
2. Cambiar su estado mediante el módulo A.
    
3. Eliminarla mediante el módulo A.
    
4. Verificar el rechazo de un payload inválido.
    

Desde la raíz del repositorio:

```
chmod +x test-containers.sh
./test-containers.sh
```

El script deja los contenedores ejecutándose si termina correctamente. Para detenerlos automáticamente al finalizar:

```
./test-containers.sh --down
```

Se puede cambiar la URL del gateway y el tiempo máximo de espera:

```
GATEWAY_URL=http://localhost:8081 WAIT_SECONDS=240 ./test-containers.sh --down
```

Si una prueba falla, el script muestra el estado de Compose y los últimos logs de todos los servicios.

## Uso de la API

Todas las siguientes operaciones se ejecutan contra el gateway en `http://localhost:8081`.

### Crear una cita

```
curl -i -X POST http://localhost:8081/api/citas \
  -H 'Content-Type: application/json' \
  -d '{
    "paciente_id": "PAC-4412",
    "medico_id": "MED-008",
    "fecha_hora": "2026-10-25T10:30:00Z",
    "motivo": "Control general de salud"
  }'
```

La respuesta esperada es `201 Created`. Guarda el valor `data.cita_id` de la respuesta para las siguientes operaciones.

### Cambiar el estado de una cita

Sustituye `CITA_ID` por el identificador obtenido al crear la cita:

```
curl -i -X PATCH http://localhost:8081/api/citas/CITA_ID/estado \
  -H 'Content-Type: application/json' \
  -d '{
    "nuevo_estado": "CONFIRMADA",
    "observacion": "Paciente confirmó por teléfono"
  }'
```

Los estados válidos son `PENDIENTE`, `CONFIRMADA`, `EN_CURSO`, `COMPLETADA` y `CANCELADA`. La respuesta esperada es `200 OK`.

### Eliminar una cita

```
curl -i -X DELETE http://localhost:8081/api/citas/CITA_ID
```

La respuesta esperada es `200 OK`. Una cita en estado `COMPLETADA` o `EN_CURSO` no puede eliminarse y devuelve `409 Conflict`.

Cada operación exitosa se notifica al módulo C para registrar la traza de auditoría. Si la auditoría no está disponible, el gateway registra el error en sus logs, pero no convierte una operación de negocio exitosa en un error.

## Pruebas del módulo C

### Pruebas HTTP contra el contenedor

Con el stack levantado, ejecuta desde la raíz:

```
chmod +x modulo-c/test-api.sh
./modulo-c/test-api.sh
```

El script usa por defecto `http://localhost:6000/api/auditoria`. También se puede proporcionar otra URL base:

```
./modulo-c/test-api.sh http://localhost:6000/api/auditoria
```

Valida el registro de eventos de creación, actualización y eliminación, la consulta de la traza por cita y el rechazo de un payload inválido.

### Pruebas unitarias y de integración Java

Desde `modulo-c`:

```
cd modulo-c
mvn test
cd ..
```

Estas pruebas no requieren levantar el stack completo cuando utilizan mocks. Para construir el módulo sin ejecutar pruebas:

```
cd modulo-c
mvn clean package -DskipTests
cd ..
```

## Ejecución local de un módulo

La opción recomendada es Docker Compose porque configura automáticamente la red y las URLs entre servicios. Para desarrollo aislado:

### Módulo A

Requiere Node.js 20 o posterior:

```
cd modulo-a
npm install
PORT=8080 \
MODULO_B_URL=http://localhost:5000 \
MODULO_C_URL=http://localhost:6000/api/auditoria \
npm start
```

En otra terminal, el gateway queda disponible en `http://localhost:8080` cuando se ejecuta fuera de Docker.

### Módulo B

Requiere Python 3.11 o posterior:

```
cd modulo-b
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 5000
```

Si PostgreSQL no está disponible, el módulo B utiliza SQLite local como respaldo de desarrollo. Para usar PostgreSQL local, configura `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`.

### Módulo C

Con Java 17 y MongoDB disponibles:

```
cd modulo-c
mvn spring-boot:run
```

El servicio escucha en el puerto `6001` por defecto. Para conectarlo con el módulo A ejecutado localmente, usa:

```
MODULO_C_URL=http://localhost:6001/api/auditoria
```

## Consultar las bases de datos

### PostgreSQL

```
docker exec -it medly-db-relacional psql -U postgres -d citas_db -c \
  "SELECT cita_id, paciente_id, estado, creado_en FROM citas ORDER BY creado_en DESC;"
```

El puerto publicado para clientes externos es `5433`; dentro de la red de Compose PostgreSQL utiliza `db-relacional:5432`.

### MongoDB Atlas Local

```
docker exec -it medly-atlas-local mongosh \
  "mongodb://localhost:27017/medly_audit?directConnection=true" \
  --eval "db.eventos_auditoria.find().sort({timestamp: -1}).pretty()"
```

URI para MongoDB Compass:

```
mongodb://localhost:27017/medly_audit?directConnection=true
```

Los scripts de inicialización de la base de datos se encuentran en `modulo-c/database/init/` y se ejecutan al crear el contenedor por primera vez.

## Estructura del proyecto

```
medly/
├── docker-compose.yml       # Orquestación, red, salud y volúmenes
├── test-containers.sh       # Prueba de integración del stack completo
├── modulo-a/                # Gateway Node.js + Express
├── modulo-b/                # Servicio de dominio FastAPI + PostgreSQL
└── modulo-c/                # Auditoría Spring Boot + MongoDB
    ├── database/init/       # Inicialización y datos semilla de MongoDB
    ├── src/main/            # Aplicación Java
    ├── src/test/            # Pruebas Java
    ├── test-api.sh          # Pruebas HTTP del servicio de auditoría
    └── tests.http           # Colección para REST Client
```

