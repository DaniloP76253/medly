package com.medly.moduloc.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
public class NodeIdentityFilter extends OncePerRequestFilter {

    private final String nodeId = System.getenv().getOrDefault(
            "NODE_ID", System.getenv().getOrDefault("HOSTNAME", "modulo-c-local"));

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        response.setHeader("X-Node-Id", nodeId);
        filterChain.doFilter(request, response);
    }
}
