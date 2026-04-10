# =============================================================================
# Provider version pins
# =============================================================================
# .terraform.lock.hcl is committed to the repo (like a lockfile).
# Run `tofu init -upgrade` to update provider versions.
# =============================================================================

terraform {
  required_version = ">= 1.8"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}
