package com.medly.moduloc.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RegistroEventoRequest {

    @NotBlank(message = "El ID de la cita es obligatorio")
    private String citaId;

    @NotBlank(message = "El tipo de operación es obligatorio")
    private String tipoOperacion; // CREACION, ACTUALIZACION_ESTADO, ELIMINACION

    private String estadoCita; // Current state after operation

    private String estadoAnterior; // Previous state (for updates)

    @NotBlank(message = "El resultado de la operación es obligatorio")
    private String resultado; // SUCCESS or ERROR

    private String ipOrigen;

    private String servicioOrigen; // MODULO_A, MODULO_B

    private Map<String, Object> detalleOperacion; // Flexible payload details
}
