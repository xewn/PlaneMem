package planemem.authz

default allow := false

allow if {
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  input.action == "mcp.discover"
}

allow if {
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  input.action == "context.read"
  "context.read" in input.context.capabilities
}

allow if {
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  input.action == "context.write"
  "context.write" in input.context.capabilities
}

allow if {
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  input.action == "audit.read"
  "audit.read" in input.context.capabilities
}

allow if {
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  input.action in {"session.write", "handoff.claim", "conflict.resolve", "sync.read", "sync.write", "proposal.write", "proposal.review", "context.review", "artifact.read", "artifact.write"}
  input.action in input.context.capabilities
}

allow if {
  "admin" in input.context.roles
}

# Gateway also applies local read/export checks before this decision, including for admins.
allow if {
  input.action == "export.artifact"
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  "artifact.read" in input.context.capabilities
  artifact_export_allowed
  artifact_read_allowed
}

artifact_export_allowed if { input.resource.classification == "public" }
artifact_export_allowed if {
  input.resource.classification in {"internal", "confidential"}
  "data.export" in input.context.capabilities
}
artifact_export_allowed if { "data.restricted.export" in input.context.capabilities }
artifact_read_allowed if { input.resource.classification in {"public", "internal", "confidential"} }
artifact_read_allowed if { "data.restricted.read" in input.context.capabilities }

# Gateway requires a verified client, finite unexpired token and actual capabilities,
# including for admins. This decision is made only after reading the scoped record.
allow if {
  input.action == "export.audit"
  input.context.tenant_id == input.resource.tenant_id
  input.context.workspace_id == input.resource.workspace_id
  input.context.project_id == input.resource.project_id
  "audit.read" in input.context.capabilities
  audit_export_capability
  artifact_export_allowed
  artifact_read_allowed
}

audit_export_capability if { "data.export" in input.context.capabilities }
audit_export_capability if { "data.restricted.export" in input.context.capabilities }
