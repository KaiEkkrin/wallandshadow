# =============================================================================
# Input variables
# =============================================================================
# Non-secret values go in terraform.tfvars (committed).
# Secret values come from environment variables (HCLOUD_TOKEN, etc.).
# =============================================================================

variable "location" {
  description = "Hetzner DC location (fsn1 = Falkenstein, nbg1 = Nuremberg, hel1 = Helsinki)"
  type        = string
  default     = "fsn1"
}

variable "server_type" {
  description = "Hetzner VPS server type"
  type        = string
  default     = "cpx21"
}

variable "server_image" {
  description = "OS image for the VPS"
  type        = string
  default     = "ubuntu-24.04"
}

variable "volume_size" {
  description = "Volume size in GB (can only grow, never shrink)"
  type        = number
  default     = 20
}

variable "ssh_public_key" {
  description = "SSH public key content (derived from private key in CI)"
  type        = string
}
