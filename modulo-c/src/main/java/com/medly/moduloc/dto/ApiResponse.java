package com.medly.moduloc.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {

    private String status; // SUCCESS or ERROR
    private int codigo;
    private String mensaje;
    private T data;
    private List<DetalleError> detalles;

    public static <T> ApiResponse<T> success(int codigo, String mensaje, T data) {
        return ApiResponse.<T>builder()
                .status("SUCCESS")
                .codigo(codigo)
                .mensaje(mensaje)
                .data(data)
                .build();
    }

    public static <T> ApiResponse<T> error(int codigo, String mensaje, List<DetalleError> detalles) {
        return ApiResponse.<T>builder()
                .status("ERROR")
                .codigo(codigo)
                .mensaje(mensaje)
                .detalles(detalles)
                .build();
    }
}
