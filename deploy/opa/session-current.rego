package planemem.session_current

# No default policy data is shipped. The deployment owner supplies the approved revision,
# exact endpoint/configuration, finite validity and current revocation lists independently.
default allow := false

allow if {
  policy := data.planemem.session_current_policy
  policy.enabled == true
  regex.match("^[a-f0-9]{64}$", policy.revision)
  input.action == "session.current.read"
  input.target.protocol_version == "p02-session-current-v1"
  input.target.endpoint_ref == policy.endpoint_ref
  input.target.configuration_digest == policy.configuration_digest
  input.context.authenticated_client == true
  input.context.tenant_id == input.target.tenant_id
  input.context.workspace_id == input.target.workspace_id
  input.context.project_id == input.target.project_id
  input.context.actor_id == input.target.actor_id
  input.context.client_id == input.target.client_id
  "context.read" in input.context.capabilities
  regex.match("^[0-7][0-9A-HJKMNP-TV-Z]{25}$", input.target.session_id)
  regex.match("^[a-f0-9]{64}$", input.target.challenge)
  regex.match("^[a-f0-9]{64}$", input.context.token_digest)
  is_array(policy.revoked_subjects)
  is_array(policy.revoked_clients)
  is_array(policy.revoked_token_digests)
  not input.context.actor_id in policy.revoked_subjects
  not input.context.client_id in policy.revoked_clients
  not input.context.token_digest in policy.revoked_token_digests
  is_number(policy.valid_from_epoch_seconds)
  is_number(policy.expires_at_epoch_seconds)
  policy.valid_from_epoch_seconds >= 0
  policy.valid_from_epoch_seconds == floor(policy.valid_from_epoch_seconds)
  policy.expires_at_epoch_seconds == floor(policy.expires_at_epoch_seconds)
  policy.expires_at_epoch_seconds > policy.valid_from_epoch_seconds
  policy.expires_at_epoch_seconds <= 253402300799
  now := time.now_ns() / 1000000000
  policy.valid_from_epoch_seconds <= now
  policy.expires_at_epoch_seconds > now
  input.context.token_expires_at_epoch_seconds > now
}

decision := {
  "allow": allow,
  "policy_revision": policy.revision,
  "policy_digest": crypto.sha256(json.marshal(policy)),
  "endpoint_ref": policy.endpoint_ref,
  "configuration_digest": policy.configuration_digest,
  "expires_at_epoch_seconds": min([policy.expires_at_epoch_seconds, input.context.token_expires_at_epoch_seconds]),
} if {
  policy := data.planemem.session_current_policy
}
