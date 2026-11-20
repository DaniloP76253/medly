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

El servicio fija `hostname: atlas-local`, que es el nombre estable que MongoDB
usa para anunciar el miembro del Replica Set dentro de la red Compose. También
se conserva el healthcheck provisto por la imagen de Atlas Local; este espera
MongoDB, Search y los scripts de inicialización.

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

## Configuración persistida del Replica Set

Si los logs muestran `Locally stored replica set configuration does not have a
valid entry for the current node`, `NodeNotFound`, o un `localConfigSetName`
distinto de `commandLineSetName`, el volumen conserva el hostname anterior del
contenedor. Compose fija ahora `hostname: atlas-local`, pero MongoDB no cambia
automáticamente la configuración ya guardada en `atlas_local_config`.

Confirma los nombres de los volúmenes antes de hacer cambios:

```bash
sudo docker inspect medly-atlas-local --format \
  '{{range .Mounts}}{{if .Name}}{{.Name}} -> {{.Destination}}{{println}}{{end}}{{end}}'
```

Si necesitas conservar los datos de auditoría, **no borres los volúmenes**;
respalda la base y reconfigura el Replica Set antes de continuar. Para este
prototipo, si los datos de auditoría pueden regenerarse desde la semilla, elimina
solo los volúmenes de Atlas Local. `pgdata` no se toca:

```bash
sudo docker compose down
sudo docker volume rm medly_atlas_local_data medly_atlas_local_config
sudo docker compose up -d atlas-local
```

Los nombres `medly_atlas_local_data` y `medly_atlas_local_config` corresponden
al proyecto Compose llamado `medly`. Si el comando `inspect` anterior mostró
otros nombres, usa esos nombres exactos. Espera hasta que el servicio esté
`healthy` y verifica que el hostname fijo sea miembro y primario:

```bash
docker compose ps atlas-local
sudo docker exec medly-atlas-local mongosh --quiet --eval "db.hello()"
sudo docker exec medly-atlas-local mongosh --quiet --eval "rs.status()"
```

`db.hello()` debe mostrar `isWritablePrimary: true` y `me: "atlas-local:27017"`.
Después, levanta el resto del sistema y consulta la colección:

```bash
sudo docker compose up --build -d
sudo docker exec medly-atlas-local mongosh \
  "mongodb://localhost:27017/medly_audit?directConnection=true" \
  --eval "db.eventos_auditoria.find().sort({timestamp:-1}).pretty()"
```

> **Advertencia:** eliminar `medly_atlas_local_data` borra los eventos de
> auditoría actuales; al recrear MongoDB, `01-init-audit.js` vuelve a insertar
> los datos semilla. No uses `docker compose down -v` para este problema: también
> borraría el volumen de PostgreSQL.
