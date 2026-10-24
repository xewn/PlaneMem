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

seed:
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-planemem} -d $${POSTGRES_DB:-planemem} -f /seed/seed.sql

doctor:
	node health/doctor.mjs
