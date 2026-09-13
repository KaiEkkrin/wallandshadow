# =============================================================================
# Network — firewall + static IPv4 and IPv6 addresses
# =============================================================================

# delete_protection on both addresses below: Hetzner only allows it while
# auto_delete is false, and the provider enables protection before it
# updates auto_delete — so for the adopted IPv6 address, auto-delete must be
# switched off by hand before the first apply (docs/SERVER_OPERATIONS.md,
# migration step 4).
resource "hcloud_primary_ip" "main" {
  name              = "wallandshadow-ip"
  type              = "ipv4"
  location          = var.location
  assignee_type     = "server"
  auto_delete       = false
  delete_protection = true
  labels = {
    project = "wallandshadow"
  }
}

# Reserved like the IPv4 address, so it survives a server rebuild and the
# AAAA records stay valid. Hetzner created this address along with the
# server (with auto_delete on); the import block below adopted it instead of
# allocating a new one.
resource "hcloud_primary_ip" "ipv6" {
  name              = "wallandshadow-ipv6"
  type              = "ipv6"
  location          = var.location
  assignee_type     = "server"
  auto_delete       = false
  delete_protection = true
  labels = {
    project = "wallandshadow"
  }
}

# One-time adoption of the existing address; a no-op once it is in state.
# When bootstrapping a new project from scratch, delete this block.
import {
  to = hcloud_primary_ip.ipv6
  id = "126546323"
}

resource "hcloud_firewall" "main" {
  name = "wallandshadow-fw"

  rule {
    description = "SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "HTTP"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "ICMP (ping)"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}
