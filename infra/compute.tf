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

  # Rescale in place without growing the root disk, so the server can always
  # be rescaled back down. The root disk only holds the OS and Docker images;
  # everything that must persist lives on the volume (docs/SERVER_OPERATIONS.md).
  keep_disk = true

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.main.id
    ipv6_enabled = true
    ipv6         = hcloud_primary_ip.ipv6.id
  }

  labels = {
    project = "wallandshadow"
  }

  lifecycle {
    # image: OS upgrades happen via apt, or by a deliberate rebuild after
    # changing server_image (docs/SERVER_OPERATIONS.md).
    # ssh_keys: Hetzner only sets SSH keys when it creates a server, so any
    # change here would destroy and recreate it. Rotating the deploy key is a
    # manual procedure instead (docs/SERVER_OPERATIONS.md).
    ignore_changes = [image, ssh_keys]
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
