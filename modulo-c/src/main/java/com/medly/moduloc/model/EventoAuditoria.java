package com.medly.moduloc.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;

import java.time.Instant;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "eventos_auditoria")
public class EventoAuditoria {

    @Id
    private String id;

    @Indexed
    private String citaId;

    @Indexed
    private TipoOperacion tipoOperacion;

    private String estadoCita;

    private String estadoAnterior;

    @Indexed
    private Instant timestamp;

    private String ipOrigen;

    private String hashOperacion;

    private Map<String, Object> detalleOperacion;

    private String servicioOrigen;

    private String resultado;
}
