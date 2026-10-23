package com.medly.moduloc;

import com.medly.moduloc.dto.EventoAuditoriaResponse;
import com.medly.moduloc.dto.RegistroEventoRequest;
import com.medly.moduloc.model.EventoAuditoria;
import com.medly.moduloc.model.TipoOperacion;
import com.medly.moduloc.repository.EventoAuditoriaRepository;
import com.medly.moduloc.service.AuditoriaService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuditoriaServiceTest {

    @Mock
    private EventoAuditoriaRepository repository;

    @InjectMocks
    private AuditoriaService auditoriaService;

    @Test
    @DisplayName("Debe registrar un evento generando hash SHA-256 inmutable")
    void testRegistrarEventoConHash() {
        RegistroEventoRequest request = RegistroEventoRequest.builder()
                .citaId("cita_98a7b6c5")
                .tipoOperacion("CREACION")
                .estadoCita("PENDIENTE")
                .resultado("SUCCESS")
                .ipOrigen("127.0.0.1")
                .servicioOrigen("MODULO_A")
                .detalleOperacion(Map.of("motivo", "Chequeo"))
                .build();

        when(repository.save(any(EventoAuditoria.class))).thenAnswer(invocation -> {
            EventoAuditoria entity = invocation.getArgument(0);
            entity.setId("generated_mongo_id_123");
            return entity;
        });

        EventoAuditoriaResponse response = auditoriaService.registrarEvento(request);

        assertNotNull(response);
        assertEquals("cita_98a7b6c5", response.getCitaId());
        assertEquals("CREACION", response.getTipoOperacion());
        assertNotNull(response.getHashOperacion(), "El hash SHA-256 debe ser generado");
        assertEquals(64, response.getHashOperacion().length(), "El hash SHA-256 debe tener 64 caracteres hexadecimales");
        assertNotNull(response.getTimestamp(), "El timestamp del evento debe ser asignado");

        verify(repository).save(any(EventoAuditoria.class));
    }
}

