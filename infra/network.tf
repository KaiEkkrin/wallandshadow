# =============================================================================
# Network — firewall + static IPv4 and IPv6 addresses
# =============================================================================

# delete_protection on both addresses below: an apply that would delete a
# reserved address fails instead of losing it — for example the in-place
# public_net update that hcloud_server.main's lifecycle block guards against.
# Hetzner only allows it while auto_delete is false.
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
# server (with auto_delete on); it was adopted into state with an import
# block rather than allocated anew.
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
