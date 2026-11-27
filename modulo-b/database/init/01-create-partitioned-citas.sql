-- Migración idempotente: conserva una tabla antigua como citas_legacy, crea la
-- tabla particionada y copia sus filas. citas_legacy se mantiene como respaldo.
DO $$
DECLARE
    citas_kind "char";
BEGIN
    SELECT relkind
      INTO citas_kind
      FROM pg_class
     WHERE oid = to_regclass('public.citas');

    IF citas_kind = 'r' THEN
        IF to_regclass('public.citas_legacy') IS NOT NULL THEN
            RAISE EXCEPTION 'Existen citas y citas_legacy; se requiere revisión manual';
        END IF;
        ALTER TABLE citas RENAME TO citas_legacy;
    END IF;

    IF to_regclass('public.citas') IS NULL THEN
        CREATE TABLE citas (
            cita_id VARCHAR(50) NOT NULL,
            paciente_id VARCHAR(50) NOT NULL,
            medico_id VARCHAR(50) NOT NULL,
            fecha_hora VARCHAR(50) NOT NULL,
            motivo TEXT NOT NULL,
            estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE',
            observacion TEXT,
            creado_en VARCHAR(50) NOT NULL,
            actualizado_en VARCHAR(50) NOT NULL,
            PRIMARY KEY (cita_id)
        ) PARTITION BY HASH (cita_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS citas_p0 PARTITION OF citas FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE IF NOT EXISTS citas_p1 PARTITION OF citas FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE IF NOT EXISTS citas_p2 PARTITION OF citas FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE IF NOT EXISTS citas_p3 PARTITION OF citas FOR VALUES WITH (MODULUS 4, REMAINDER 3);

CREATE INDEX IF NOT EXISTS idx_citas_paciente_id ON citas (paciente_id);
CREATE INDEX IF NOT EXISTS idx_citas_medico_id ON citas (medico_id);
CREATE INDEX IF NOT EXISTS idx_citas_creado_en ON citas (creado_en DESC);

DO $$
BEGIN
    IF to_regclass('public.citas_legacy') IS NOT NULL THEN
        INSERT INTO citas (
            cita_id, paciente_id, medico_id, fecha_hora, motivo, estado,
            observacion, creado_en, actualizado_en
        )
        SELECT
            cita_id, paciente_id, medico_id, fecha_hora, motivo, estado,
            observacion, creado_en, actualizado_en
        FROM citas_legacy
        ON CONFLICT (cita_id) DO NOTHING;
    END IF;
END $$;
