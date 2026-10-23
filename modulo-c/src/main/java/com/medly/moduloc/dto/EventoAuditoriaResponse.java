package com.medly.moduloc.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EventoAuditoriaResponse {

    private String id;
    private String citaId;
    private String tipoOperacion;
    private String estadoCita;
    private String estadoAnterior;
    private Instant timestamp;
    private String ipOrigen;
    private String hashOperacion;
    private Map<String, Object> detalleOperacion;
    private String servicioOrigen;
    private String resultado;
}
