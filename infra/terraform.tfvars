# =============================================================================
# Terraform variable values — Wall & Shadow
# =============================================================================
# Non-secret values only. Safe to commit.
# Secret values (HCLOUD_TOKEN, S3 keys) come from environment variables.
#
# ssh_public_key is provided via -var in CI (derived from the private key).
# =============================================================================

location    = "hel1"
server_type = "cx23"
server_image = "ubuntu-24.04"
volume_size = 10
