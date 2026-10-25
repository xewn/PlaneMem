COMPOSE ?= docker compose --env-file .env.example -f docker-compose.yml

.PHONY: up down reset migrate seed doctor

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up -d

migrate:
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/001_baseline.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/002_contracts.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/003_artifacts.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/004_sessions.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/005_sync.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/006_outbox.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/007_audit.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/009_runtime_state.sql
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /docker-entrypoint-initdb.d/010_session_continuity_persistence.sql

seed:
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /seed/seed.sql

doctor:
	node health/doctor.mjs
