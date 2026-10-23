package com.medly.moduloc.exception;

import com.medly.moduloc.dto.ApiResponse;
import com.medly.moduloc.dto.DetalleError;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;
import java.util.stream.Collectors;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationErrors(
            MethodArgumentNotValidException ex) {

        List<DetalleError> detalles = ex.getBindingResult().getFieldErrors()
                .stream()
                .map(error -> DetalleError.builder()
                        .campo(error.getField())
                        .mensaje(error.getDefaultMessage())
                        .build())
                .collect(Collectors.toList());

        log.warn("Error de validación: {}", detalles);

        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(
                        400,
                        "Error de validación en los datos de la solicitud",
                        detalles
                ));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalArgument(
            IllegalArgumentException ex) {

        log.warn("Argumento inválido: {}", ex.getMessage());

        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(
                        400,
                        "Argumento inválido en la solicitud",
                        List.of(DetalleError.builder()
                                .campo("tipoOperacion")
                                .mensaje(ex.getMessage())
                                .build())
                ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleGenericException(Exception ex) {

        log.error("Error interno del servidor", ex);

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error(
                        500,
                        "Error interno del servidor",
                        List.of(DetalleError.builder()
                                .campo("servidor")
                                .mensaje("Ha ocurrido un error inesperado. Por favor, intente nuevamente.")
                                .build())
                ));
    }
}
