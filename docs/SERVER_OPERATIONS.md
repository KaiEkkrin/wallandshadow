# Server Operations

How the Hetzner VPS keeps its state, and the manual procedures for migrating,
rescaling, rebuilding, rotating the deploy key and restoring the database.
Commands marked **(on the server)** are run by the operator over SSH as root;
no automation runs them. For first-time setup see
[INFRASTRUCTURE_BOOTSTRAP.md](INFRASTRUCTURE_BOOTSTRAP.md).

## What lives where

Everything that must survive losing the server lives on the Hetzner volume
`wallandshadow-pgdata`, mounted at `/mnt/pgdata` (the name predates its other
contents), or off the server entirely.

| State | Where | After a rebuild |
| --- | --- | --- |
| PostgreSQL data (production and test databases) | volume: `/mnt/pgdata/main` | kept |
| Secrets file: DB password, JWT secret, S3 keys | volume: `/mnt/pgdata/wallandshadow/secrets` | kept |
| Caddy's certificates and ACME account | volume: `/mnt/pgdata/caddy` | kept |
| User images | Hetzner Object Storage | kept (never on the server) |
| IPv4 and IPv6 addresses | reserved Primary IPs (`auto_delete = false`) | kept |
| Nightly production DB dumps | `wallandshadow-backups` bucket | kept |
| Env files, systemd units, Caddyfile, cron, firewall | root disk, rendered by Ansible | re-rendered by the provision workflow |
| Image tags (`/etc/wallandshadow/<env>.image`) | root disk | re-seeded to `latest-test` / `latest-prod`, which each deploy moves to what it deployed |
| SSH host keys | root disk | **new** — update the `VPS_KNOWN_HOST` secret |
| Logs and traffic stats history | root disk | lost |

The volume has `prevent_destroy`, and systemd won't start PostgreSQL or Caddy
unless it's mounted. Ansible refuses to change PostgreSQL roles or databases
unless the running cluster is serving `/mnt/pgdata/main`.

## The provision workflow

**Actions → Provision Infrastructure → Run workflow.** Inputs:

- **apply** (default off). Off: OpenTofu plans, the plan appears in the run
  summary, and nothing changes. On: the plan is applied and Ansible runs.
- **allow_replace** (default off). The run fails if the plan deletes or
  replaces any resource. Tick it only for a deliberate replacement, such as
  rotating the deploy key.
- **replace_server** (default off). Plans a rebuild of the server from scratch
  (see [Rebuilding](#rebuilding)). Implies allow_replace.

Always run with **apply** off first and read the plan.

## One-time migration of the current server

The server was provisioned before this layout existed. The migration moves
the secrets file and Caddy's storage onto the volume, and reserves the IPv6
address. No downtime is expected; Caddy reloads in place.

### 1. Record the current state

**(on the server)**

```bash
findmnt /mnt/pgdata
sudo -u postgres psql -Atc 'SHOW data_directory'
df -h / /mnt/pgdata
ls -la /mnt/pgdata /etc/wallandshadow
ls /var/lib/caddy/.local/share/caddy/certificates/*/
sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'
tail -n 3 /var/log/pg_backup.log
```

Expect:

- `findmnt` shows `/mnt/pgdata` on an ext4 device.
- `data_directory` is `/mnt/pgdata/main`.
- `/etc/wallandshadow/secrets` exists.
- The certificates listing includes `wallandshadow.com`,
  `www.wallandshadow.com` and `test.wallandshadow.com`.
- The last backup line reads `Backup complete: wallandshadow-<last night>.sql.gz`.

Note the user count. **Stop** if `data_directory` isn't `/mnt/pgdata/main` or
the certificates directory is missing: the migration assumes both.

**(on your own machine)** Record the certificate serials, to confirm later
that nothing was re-issued:

```bash
for h in wallandshadow.com test.wallandshadow.com; do
  echo | openssl s_client -connect "$h:443" -servername "$h" 2>/dev/null \
    | openssl x509 -noout -serial -enddate
done
```

### 2. Back up

**(on the server)**

```bash
/usr/local/bin/pg_backup.sh
sudo -u postgres pg_dump wallandshadow_test | gzip > "/root/wallandshadow_test-$(date +%F).sql.gz"
cp -a /etc/wallandshadow/secrets /root/secrets.pre-volume
tar czf /root/caddy-data.pre-volume.tgz -C /var/lib/caddy/.local/share caddy
```

Expect `Backup complete: …` from the first command.

**(Hetzner Console)** Servers → wallandshadow → Snapshots → Create snapshot.
The snapshot covers the root disk only, not the volume; it is the rollback for
`/etc` and friends.

### 3. Merge the PR

Merging changes nothing on the server: provisioning is manual, and no deploy
workflow watches `ansible/` or `infra/`.

### 4. Plan

Run the provision workflow with all inputs off. In the plan (run summary),
expect exactly:

- `hcloud_primary_ip.ipv6` **will be imported**, then updated in place: name →
  `wallandshadow-ipv6`, `auto_delete` → `false`, labels.
- `hcloud_server.main` updated in place for `keep_disk` only.
- The **Refuse plans that delete or replace resources** step passes.

If `hcloud_server.main` also shows a `public_net` change, the provider may
power the server off briefly to assign the address. That's safe — everything
starts again on boot — but it's downtime, so apply at a quiet time. **Stop**
if anything else appears, or if the guard step fails.

### 5. Apply

Run the workflow with **apply** on (allow_replace and replace_server off). In
the Ansible log, expect `changed` for:

- the volume root ownership and the new directories;
- the systemd drop-ins;
- `Write secrets file` and `Remove the legacy secrets file…`;
- `Deploy backup script` (it now reads the secrets file on the volume);
- `Copy Caddy's certificates and ACME account onto the volume`;
- `Deploy Caddyfile`.

`Restart PostgreSQL onto the volume` is **skipped**, because `data_directory`
didn't change. `Refuse to touch roles or databases…` passes.

### 6. Verify

**(on the server)**

```bash
ls -la /mnt/pgdata
diff <(grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|DATABASE_URL_)' /root/secrets.pre-volume) <(grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|DATABASE_URL_)' /mnt/pgdata/wallandshadow/secrets) && echo "secrets unchanged"
test ! -e /etc/wallandshadow/secrets && echo "legacy secrets file removed"
ls /mnt/pgdata/caddy/certificates/*/
systemctl show -p RequiresMountsFor caddy.service postgresql@17-main.service
journalctl -u caddy --since '-30 min' | grep -iE 'obtain|error' || echo "no certificate requests or errors"
curl -fsS https://wallandshadow.com/api/health; echo
curl -fsS https://test.wallandshadow.com/api/health; echo
```

Expect:

- `/mnt/pgdata` holds `main` (postgres), `wallandshadow` (root, `drwx------`)
  and `caddy` (caddy, `drwx------`).
- `secrets unchanged` (it compares the database password, JWT secret and
  database URLs).
- `legacy secrets file removed`.
- The same three certificate directories as step 1.
- `RequiresMountsFor=/mnt/pgdata` twice.
- `no certificate requests or errors`.
- `{"ok":true}` twice.

**(on your own machine)** Re-run the serial check from step 1. The serials
must match.

### 7. Reboot test (about a minute of downtime)

This checks the boot ordering while you're watching. Unattended-upgrades
reboots this server at 04:30 whenever an update needs it anyway.

**(on the server)**

```bash
systemctl reboot
```

Then, once it's back:

```bash
findmnt /mnt/pgdata
systemctl is-active postgresql@17-main caddy wallandshadow-test wallandshadow-prod
sudo -u postgres psql -Atc 'SHOW data_directory'
sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'
```

Expect the mount, four `active` lines, `/mnt/pgdata/main`, and the user count
from step 1. Check both health endpoints again.

**(on your own machine)** Re-run the serial check from step 1. After the
reboot Caddy is certainly serving from the volume, so matching serials prove
the copied certificates are the ones in use.

### 8. Tidy up, after a week

- **(Hetzner Console)** Delete the snapshot.
- **(on the server)** Remove the pre-migration copies:

  ```bash
  rm /root/secrets.pre-volume /root/caddy-data.pre-volume.tgz /root/wallandshadow_test-*.sql.gz
  rm -r /var/lib/caddy/.local/share/caddy   # Caddy no longer reads it
  ```

## Rescaling

1. Change `server_type` in `infra/terraform.tfvars` in a PR, and merge it.
   Check first that Hetzner Console → the server → **Rescale** lists the
   target type in `hel1`. Hetzner can't rescale to a type with a smaller disk
   than the current one.
2. Plan (apply off). Expect `hcloud_server.main` **updated in place**, with
   `server_type` changing, and the guard step passing. **Stop** if the server
   would be replaced.
3. Apply (apply on). The provider powers the server off, changes its type and
   powers it on: a few minutes of downtime for both environments. With
   `keep_disk = true` the root disk keeps its size, so you can always rescale
   back down.
4. Verify as in step 7 of the migration.

## Rebuilding

Rebuild when upgrading to a new Ubuntu LTS (change `server_image` in
`infra/terraform.tfvars` first), when the root disk is broken, or to rehearse
this procedure. Expect 10–15 minutes of downtime.

1. **(on the server, if it's reachable)** Run `/usr/local/bin/pg_backup.sh`
   and check for `Backup complete: …`. Note the user count
   (`sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'`).
2. Plan with **replace_server** on and apply off. Expect `hcloud_server.main`
   and `hcloud_volume_attachment.pgdata` to be replaced, and nothing else. In
   particular, the volume and both Primary IPs must be unchanged.
3. Run it again with **replace_server** and **apply** on. OpenTofu destroys the
   old server and creates a new one with the same addresses and the volume
   attached. Ansible then mounts the volume, reuses the secrets on it, points
   PostgreSQL at the real data (checked before any database change) and gives
   Caddy its stored certificates.

   If the Ansible job fails (for example on an apt lock while the new server
   is still finishing its first boot), re-run with **apply** on and
   **replace_server off**. Leaving replace_server on would rebuild the server
   again.
4. Copy the `VPS_KNOWN_HOST` block printed at the end of the run into that
   secret in the `hetzner` environment. Deploys fail at SSH until you do.
5. **(on the server)** Start the applications. They come up on the last
   deployed images (`latest-test`, `latest-prod`):

   ```bash
   systemctl start wallandshadow-test wallandshadow-prod
   ```

6. Verify with the step 6 and step 7 checks from the migration. The user count
   must match step 1. Traffic stats and logs start again from empty.

## Rotating the deploy SSH key

Hetzner only installs SSH keys when it creates a server, and OpenTofu ignores
key changes on the existing one, so:

1. Generate a new key:
   `ssh-keygen -t ed25519 -C wallandshadow-deploy -f ~/.ssh/wallandshadow_deploy_new`
2. **(on the server)** Append the new public key to `/root/.ssh/authorized_keys`.
3. Put the new private key in the `SSH_PRIVATE_KEY` secret.
4. Plan (apply off). Expect only `hcloud_ssh_key.deploy` to be replaced. The
   guard step fails on that, as designed.
5. Apply with **apply** and **allow_replace** on.
6. Check that a deploy still works (for example, re-run the latest test deploy),
   then **(on the server)** remove the old key from
   `/root/.ssh/authorized_keys`.

To rotate the database password and JWT secret instead, use
`ansible/rotate_secrets.sh` on the server; it edits the secrets file on the
volume.

## Restoring the database from a backup

Not yet rehearsed; try it against the test database before you need it. The
nightly dumps cover the production database only.

**(on the server)**

```bash
export AWS_ACCESS_KEY_ID=$(grep '^S3_ACCESS_KEY=' /mnt/pgdata/wallandshadow/secrets | cut -d= -f2-)
export AWS_SECRET_ACCESS_KEY=$(grep '^S3_SECRET_KEY=' /mnt/pgdata/wallandshadow/secrets | cut -d= -f2-)
aws s3 ls s3://wallandshadow-backups/db/ --endpoint-url https://hel1.your-objectstorage.com | tail -n 3
```

Pick the dump to restore (`DUMP=wallandshadow-YYYYMMDD-HHMMSS.sql.gz`), then:

```bash
aws s3 cp "s3://wallandshadow-backups/db/$DUMP" /root/ --endpoint-url https://hel1.your-objectstorage.com
systemctl stop wallandshadow-prod
sudo -u postgres dropdb wallandshadow
sudo -u postgres createdb -O was wallandshadow
gunzip -c "/root/$DUMP" | sudo -u postgres psql -v ON_ERROR_STOP=1 wallandshadow
systemctl start wallandshadow-prod
```
