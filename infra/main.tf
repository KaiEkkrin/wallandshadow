# =============================================================================
# OpenTofu — Wall & Shadow infrastructure
# =============================================================================
# Manages Hetzner Cloud resources: VPS, volume, static IP, firewall.
#
# State is stored in a Hetzner Object Storage bucket (S3-compatible).
# See README.md "Infrastructure Bootstrap" for first-time setup.
#
# Authentication:
#   HCLOUD_TOKEN          — Hetzner Cloud API token (env var)
#   AWS_ACCESS_KEY_ID     — Hetzner Object Storage access key (env var, for state backend)
#   AWS_SECRET_ACCESS_KEY — Hetzner Object Storage secret key (env var, for state backend)
# =============================================================================

terraform {
  backend "s3" {
    bucket = "wallandshadow-tfstate"
    key    = "terraform.tfstate"
    region = "eu-central"

    # Hetzner Object Storage S3 endpoint — update to match your DC location.
    # Falkenstein: fsn1, Nuremberg: nbg1, Helsinki: hel1
    endpoints = {
      s3 = "https://hel1.your-objectstorage.com"
    }

    # Hetzner S3 is not AWS — disable AWS-specific checks
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    skip_region_validation      = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}

provider "hcloud" {
  # HCLOUD_TOKEN env var provides the API token
}
