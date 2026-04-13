# =============================================================================
# Outputs — consumed by Ansible and deploy workflows
# =============================================================================

output "vps_ip" {
  description = "Static IPv4 address of the VPS"
  value       = hcloud_primary_ip.main.ip_address
}

output "volume_id" {
  description = "Hetzner volume ID (used to construct /dev/disk/by-id/scsi-0HC_Volume_<id>)"
  value       = hcloud_volume.pgdata.id
}

output "server_id" {
  description = "Hetzner server ID"
  value       = hcloud_server.main.id
}
