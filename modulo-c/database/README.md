# Base de Datos — Módulo C (MongoDB Atlas Local)

Esta carpeta contiene los scripts de inicialización y datos semilla de la base de datos de auditoría de Medly.

## Estructura

```
database/
├── init/
│   └── 01-init-audit.js     # Script de inicialización: colección, índices y datos semilla
└── README.md
```

## Orquestación Centralizada

La base de datos de MongoDB Atlas Local (`medly-atlas-local`) se orquesta de forma unificada desde el archivo principal [`docker-compose.yml`](../../docker-compose.yml) en la raíz del proyecto.

```bash
# Desde la raíz del proyecto:
docker compose up -d atlas-local
```

## Características

- **Imagen**: [`mongodb/mongodb-atlas-local:latest`](https://hub.docker.com/r/mongodb/mongodb-atlas-local) (contenedor oficial de MongoDB Atlas).
- **Base de Datos**: `medly_audit`
- **Colección Principal**: `eventos_auditoria`
- **Índices configurados**:
  - `idx_cita_id` sobre `citaId`
  - `idx_tipo_operacion` sobre `tipoOperacion`
  - `idx_timestamp_desc` sobre `timestamp` (descendente)
  - `idx_cita_tipo` compuesto sobre `(citaId, tipoOperacion)`
  - `idx_hash_unique` índice único sobre `hashOperacion` (garantiza inmutabilidad e integridad)

## Conexión a la Base de Datos

- **Desde el host (MongoDB Compass / mongosh)**:
  ```
  mongodb://localhost:27017/medly_audit?directConnection=true
  ```

- **Desde otro contenedor Docker (Módulo C / red `medly-net`)**:
  ```
  mongodb://atlas-local:27017/medly_audit?directConnection=true
  ```

## Reinicializar datos desde cero

Para volver a ejecutar el script `01-init-audit.js` y reiniciar la base de datos:
```bash
docker compose down -v
docker compose up -d
```

## Recuperación de volúmenes dañados

Si MongoDB está `healthy`, pero `mongosh` muestra errores como `Does not have a
valid replica set config` o `Our replica set config is invalid or we are not a
member of it`, primero revisa la configuración persistida sin modificarla:

```bash
docker exec -it medly-atlas-local mongosh --quiet --eval \
  "db.getSiblingDB('local').system.replset.findOne()"

docker inspect -f "{{.Config.Hostname}}" medly-atlas-local
```

Si no necesitas conservar los datos actuales, recrea los volúmenes de MongoDB:

```bash
docker compose down -v
docker compose up -d atlas-local
```

Espera hasta que el servicio esté disponible y verifica que el nodo sea el
primario:

```bash
docker compose ps atlas-local
docker exec -it medly-atlas-local mongosh --quiet --eval "db.hello()"
docker exec -it medly-atlas-local mongosh --quiet --eval "rs.status()"
```

`db.hello()` debe mostrar `isWritablePrimary: true`. Después, puedes consultar
la colección:

```bash
docker exec -it medly-atlas-local mongosh \
  "mongodb://localhost:27017/medly_audit?directConnection=true" \
  --eval "db.eventos_auditoria.find().sort({timestamp:-1}).pretty()"
```

> **Advertencia:** `docker compose down -v` elimina los volúmenes
> `atlas_local_data` y `atlas_local_config`, por lo que borra los datos
> actuales. El script `01-init-audit.js` se ejecutará nuevamente al crear la
> base de datos.
