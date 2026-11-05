package planemem.session_current

# Source-only cases. No OPA evaluation was run during the factory development phase.
fixture_policy := {
  "enabled": true,
  "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "endpoint_ref": "explicit-fixture",
  "configuration_digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "valid_from_epoch_seconds": 0,
  "expires_at_epoch_seconds": 4102444800,
  "revoked_subjects": [], "revoked_clients": [], "revoked_token_digests": [],
}

fixture_input := {
  "action": "session.current.read",
  "target": {
    "protocol_version": "p02-session-current-v1", "endpoint_ref": "explicit-fixture",
    "configuration_digest": fixture_policy.configuration_digest,
    "tenant_id": "tenant", "workspace_id": "workspace", "project_id": "project",
    "actor_id": "actor", "client_id": "client", "session_id": "01HF7YAT000000000000000004",
    "challenge": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  },
  "context": {
    "authenticated_client": true,
    "tenant_id": "tenant", "workspace_id": "workspace", "project_id": "project",
    "actor_id": "actor", "client_id": "client", "capabilities": ["context.read"],
    "token_expires_at_epoch_seconds": 4102444800,
    "token_digest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
}

test_current_owner if {
  allow with data.planemem.session_current_policy as fixture_policy with input as fixture_input
}
test_no_header_admin_bypass if {
  bad := object.union(fixture_input, {"context": object.union(fixture_input.context, {
    "capabilities": [], "roles": ["admin"],
  })})
  not allow with data.planemem.session_current_policy as fixture_policy with input as bad
}
test_other_owner if {
  bad := object.union(fixture_input, {"target": object.union(fixture_input.target, {"actor_id": "other"})})
  not allow with data.planemem.session_current_policy as fixture_policy with input as bad
}
test_revoked_subject if {
  revoked := object.union(fixture_policy, {"revoked_subjects": ["actor"]})
  not allow with data.planemem.session_current_policy as revoked with input as fixture_input
}
test_revoked_client if {
  revoked := object.union(fixture_policy, {"revoked_clients": ["client"]})
  not allow with data.planemem.session_current_policy as revoked with input as fixture_input
}
test_revoked_token if {
  revoked := object.union(fixture_policy, {"revoked_token_digests": [fixture_input.context.token_digest]})
  not allow with data.planemem.session_current_policy as revoked with input as fixture_input
}
test_expired_policy if {
  expired := object.union(fixture_policy, {"expires_at_epoch_seconds": 1})
  not allow with data.planemem.session_current_policy as expired with input as fixture_input
}
test_changed_policy_contents_change_digest if {
  original := decision with data.planemem.session_current_policy as fixture_policy with input as fixture_input
  changed := object.union(fixture_policy, {"revoked_subjects": ["someone-else"]})
  current := decision with data.planemem.session_current_policy as changed with input as fixture_input
  original.allow == true
  current.allow == true
  original.policy_digest != current.policy_digest
}

fixture_origin_input := object.union(fixture_input, {
  "action": "session.origin.read",
  "selection_id": "00000000-0000-0000-0000-000000000001",
  "selection_digest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "context": object.union(fixture_input.context, {"capabilities": ["context.read", "context.origin.read"]}),
})

test_origin_disabled_by_default if {
  not allow with data.planemem.session_current_policy as fixture_policy with input as fixture_origin_input
}
test_origin_explicit_enable_and_capability if {
  policy := object.union(fixture_policy, {"origin_read_enabled": true})
  allow with data.planemem.session_current_policy as policy with input as fixture_origin_input
}
test_origin_current_permission_alone_denied if {
  policy := object.union(fixture_policy, {"origin_read_enabled": true})
  bad := object.union(fixture_origin_input, {"context": fixture_input.context})
  not allow with data.planemem.session_current_policy as policy with input as bad
}
test_origin_wrong_selection_denied if {
  policy := object.union(fixture_policy, {"origin_read_enabled": true})
  bad := object.union(fixture_origin_input, {"selection_digest": "not-a-digest"})
  not allow with data.planemem.session_current_policy as policy with input as bad
}
