# =============================================================================
# Compute — SSH key, VPS, volume
# =============================================================================

resource "hcloud_ssh_key" "deploy" {
  name       = "wallandshadow-deploy"
  public_key = var.ssh_public_key
}

resource "hcloud_server" "main" {
  name        = "wallandshadow"
  server_type = var.server_type
  image       = var.server_image
  location    = var.location

  ssh_keys = [hcloud_ssh_key.deploy.id]

  firewall_ids = [hcloud_firewall.main.id]

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.main.id
  }

  labels = {
    project = "wallandshadow"
  }

  # Ignore image changes — OS upgrades happen via apt, not server rebuild
  lifecycle {
    ignore_changes = [image]
  }
}

resource "hcloud_volume" "pgdata" {
  name     = "wallandshadow-pgdata"
  size     = var.volume_size
  location = var.location
  format   = "ext4"

  labels = {
    project = "wallandshadow"
    role    = "postgresql"
  }

  # Volume can only grow. Prevent accidental destruction.
  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_volume_attachment" "pgdata" {
  volume_id = hcloud_volume.pgdata.id
  server_id = hcloud_server.main.id
  automount = true
}
