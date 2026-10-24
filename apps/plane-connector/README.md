# Plane Connector

The connector owns Plane version compatibility, typed REST transport, webhook verification, delivery deduplication, replay and observed projections.

The public boundary is `@planemem/plane-connector`. Consumers use the typed `PlaneClient`, `verifyWebhook`/`acceptWebhook`, `WebhookLedger`, and `PlaneProjection` APIs. They do not access Plane tables, raw URL builders, or internal connector state.

The pinned compatibility contract is maintained in [`integrations/plane/compatibility.yaml`](../../integrations/plane/compatibility.yaml). Update the matrix, fixtures and P1 tests together when a Plane version or capability changes.
