# Base de Datos — Módulo C (MongoDB Atlas Local)

Esta carpeta contiene la configuración, infraestructura y datos semilla de la base de datos de auditoría de Medly.

## Estructura

```
database/
├── docker-compose.yml       # Levantar únicamente el contenedor de MongoDB Atlas Local
├── init/
│   └── 01-init-audit.js     # Script de inicialización: colección, índices y datos semilla
└── README.md
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

## Cómo levantar solo la Base de Datos

```bash
cd modulo-c/database
docker compose up -d
```

## Conexión a la Base de Datos

- **Desde el host (MongoDB Compass / mongosh)**:
  ```
  mongodb://localhost:27017/medly_audit?directConnection=true
  ```

- **Desde otro contenedor Docker (Módulo C / red `medly-network`)**:
  ```
  mongodb://atlas-local:27017/medly_audit?directConnection=true
  ```

## Reinicializar datos desde cero

Para volver a ejecutar el script `01-init-audit.js` y reiniciar la base de datos:
```bash
docker compose down -v
docker compose up -d
```

