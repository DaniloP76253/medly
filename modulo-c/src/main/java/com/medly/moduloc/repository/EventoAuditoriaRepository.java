package com.medly.moduloc.repository;

import com.medly.moduloc.model.EventoAuditoria;
import com.medly.moduloc.model.TipoOperacion;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface EventoAuditoriaRepository extends MongoRepository<EventoAuditoria, String> {

    List<EventoAuditoria> findByCitaIdOrderByTimestampDesc(String citaId);

    List<EventoAuditoria> findByTipoOperacionOrderByTimestampDesc(TipoOperacion tipoOperacion);

    List<EventoAuditoria> findByTimestampBetweenOrderByTimestampDesc(Instant desde, Instant hasta);

    List<EventoAuditoria> findByCitaIdAndTipoOperacionOrderByTimestampDesc(String citaId, TipoOperacion tipoOperacion);

    List<EventoAuditoria> findAllByOrderByTimestampDesc();
}
