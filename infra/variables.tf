# =============================================================================
# Input variables
# =============================================================================
# Values live in terraform.tfvars (committed). There are deliberately no
# defaults, so that file is the one place to look.
# Secret values come from environment variables (HCLOUD_TOKEN, etc.).
# =============================================================================

variable "location" {
  description = "Hetzner DC location (fsn1 = Falkenstein, nbg1 = Nuremberg, hel1 = Helsinki)"
  type        = string
}

variable "server_type" {
  description = "Hetzner VPS server type. Changing it rescales the server in place (docs/SERVER_OPERATIONS.md)"
  type        = string
}

variable "server_image" {
  description = "OS image for the VPS. Only used when the server is created or rebuilt"
  type        = string
}

variable "volume_size" {
  description = "Volume size in GB (can only grow, never shrink)"
  type        = number
}

variable "ssh_public_key" {
  description = "SSH public key content (derived from private key in CI)"
  type        = string
}
