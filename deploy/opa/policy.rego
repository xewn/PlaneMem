package planemem.authz

default allow := false

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
  "admin" in input.context.roles
}
