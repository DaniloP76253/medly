package com.medly.moduloc.config;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.config.AbstractMongoClientConfiguration;
import org.springframework.data.mongodb.config.EnableMongoAuditing;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.repository.config.EnableMongoRepositories;

import java.util.concurrent.TimeUnit;

/**
 * Configuración de MongoDB para MongoDB Atlas (tanto Atlas Local en Docker
 * usando mongodb/mongodb-atlas-local, como Atlas Cloud vía SRV).
 *
 * El ConnectionString maneja automáticamente el protocolo TLS/SSL si se usa
 * Atlas Cloud (mongodb+srv:// o ssl=true) o texto plano si se conecta a Atlas Local.
 */
@Configuration
@EnableMongoAuditing
@EnableMongoRepositories(basePackages = "com.medly.moduloc.repository")
public class MongoConfig extends AbstractMongoClientConfiguration {

    @Value("${spring.data.mongodb.uri}")
    private String mongoUri;

    @Value("${spring.data.mongodb.database}")
    private String databaseName;

    @Override
    protected String getDatabaseName() {
        return databaseName;
    }

    @Override
    @Bean
    public MongoClient mongoClient() {
        ConnectionString connectionString = new ConnectionString(mongoUri);

        MongoClientSettings settings = MongoClientSettings.builder()
                .applyConnectionString(connectionString)
                // Pool de conexiones adaptado para alta concurrencia
                .applyToConnectionPoolSettings(builder -> builder
                        .maxSize(50)
                        .minSize(5)
                        .maxWaitTime(10, TimeUnit.SECONDS)
                        .maxConnectionIdleTime(60, TimeUnit.SECONDS)
                )
                // Timeouts para operaciones de auditoría
                .applyToSocketSettings(builder -> builder
                        .connectTimeout(10, TimeUnit.SECONDS)
                        .readTimeout(15, TimeUnit.SECONDS)
                )
                // Configuración de cluster
                .applyToClusterSettings(builder -> builder
                        .serverSelectionTimeout(15, TimeUnit.SECONDS)
                )
                .build();

        return MongoClients.create(settings);
    }

    @Bean
    public MongoTemplate mongoTemplate() {
        return new MongoTemplate(mongoClient(), getDatabaseName());
    }
}
