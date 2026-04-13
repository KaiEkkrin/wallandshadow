# =============================================================================
# Network — firewall + static IPv4
# =============================================================================

resource "hcloud_primary_ip" "main" {
  name          = "wallandshadow-ip"
  type          = "ipv4"
  location      = var.location
  assignee_type = "server"
  auto_delete   = false
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
