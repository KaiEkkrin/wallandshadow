# Server Operations

How the Hetzner VPS keeps its state, and the manual procedures for migrating,
rescaling, rebuilding, updating packages, rotating the deploy key and
restoring the database.
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

Always run with **apply** off first and read the plan. The apply run plans
again from `main`, so check that nothing new has merged under `infra/` between
the two runs.

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

**(Hetzner Console)** Primary IPs → `primary_ip-126546323` → switch **Auto
delete** off. Delete protection can only be switched on once auto-delete is
off, and the provider does the two in the wrong order for that to happen as
part of the apply.

Run the provision workflow with all inputs off. In the plan (run summary),
expect exactly:

- `hcloud_primary_ip.ipv6` **will be imported**, then updated in place: name
  changes from `primary_ip-126546323` to `wallandshadow-ipv6`,
  `delete_protection` → `true`, labels; plus the harmless
  `assignee_id = <server id> -> (known after apply)` and
  `datacenter` → `(known after apply)` lines. Seeing this confirms the import
  adopted the right address — a wrong ID fails the plan with "Cannot import
  non-existent remote object", and an ID of the wrong type or location plans
  a replacement that the guard refuses. If the plan still shows `auto_delete`
  changing to `false`, the Console switch didn't take effect — **stop** and
  switch it off there (applying anyway would fail harmlessly on delete
  protection).
- `hcloud_primary_ip.main` updated in place for `delete_protection` → `true`,
  plus the same harmless `assignee_id` and `datacenter` lines.
- `hcloud_server.main` updated in place for `keep_disk` only.
- The **Refuse plans that delete or replace resources** step passes.

**Stop** if `hcloud_server.main` shows any change other than `keep_disk` — in
particular, a `public_net` change must not appear: `ignore_changes` on
`hcloud_server.main` means the plan should never propose one, and if it does
appear anyway an apply would power the server off and could reassign or
delete one of the reserved addresses. Also **stop** if the guard step fails.

### 5. Apply

Run the workflow with **apply** on (allow_replace and replace_server off). In
the Ansible log, among others, expect `changed` for:

- the volume root ownership and the new directories;
- the systemd drop-ins;
- `Write secrets file` and `Remove the legacy secrets file…`;
- `Deploy backup script` (it now reads the secrets file on the volume);
- `Copy Caddy's certificates and ACME account onto the volume`;
- `Deploy Caddyfile`.

Some tasks report `changed` on every run (for example `Apply CORS policy to
each app bucket`); what matters is that nothing unexpected fails.
`Restart PostgreSQL onto the volume` is **skipped**, because `data_directory`
didn't change. `Refuse to touch roles or databases…` passes.

### 6. Verify

**(on the server)**

```bash
ls -la /mnt/pgdata
cmp -s <(grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|DATABASE_URL_)' /root/secrets.pre-volume) <(grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|DATABASE_URL_)' /mnt/pgdata/wallandshadow/secrets) && echo "secrets unchanged" || echo "SECRETS DIFFER — stop"
test ! -e /etc/wallandshadow/secrets && echo "legacy secrets file removed"
ls /mnt/pgdata/caddy/certificates/*/
systemctl show -p RequiresMountsFor caddy.service postgresql@17-main.service
journalctl -u caddy --since '-30 min' | grep -iE 'obtain|error' || echo "no certificate requests or errors"
curl -fsS https://wallandshadow.com/api/health; echo
curl -fsS https://test.wallandshadow.com/api/health; echo
```

Expect:

- `/mnt/pgdata` holds `main` (postgres), `wallandshadow` (root, `drwx------`)
  and `caddy` (caddy, `drwx------`), alongside the filesystem's own
  `lost+found`.
- `secrets unchanged` (it compares the database password, JWT secret and
  database URLs without printing them). **Stop** if it prints
  `SECRETS DIFFER`.
- `legacy secrets file removed`.
- The same three certificate directories as step 1.
- Two `RequiresMountsFor=` lines, each including `/mnt/pgdata` (the
  PostgreSQL unit's line also lists its own config and data paths).
- `no certificate requests or errors`. Unrelated error lines can match too
  (for example reverse-proxy connection errors while an application
  restarts); the serial check below is the authoritative proof that nothing
  was re-issued.
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

   **(on your own machine)** Record the certificate serials with the serial
   check from [step 1 of the migration](#1-record-the-current-state), so the
   verification below (step 5) has a baseline to compare against.
2. Plan (apply off). Expect `hcloud_server.main` **updated in place**, with
   `server_type` changing, and the guard step passing. **Stop** if the server
   would be replaced.
3. **(on the server)** Note the user count
   (`sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'`),
   then stop the applications and PostgreSQL. Recording it right before the
   stop, rather than back in step 1, keeps sign-ups between the two from
   throwing off the comparison in step 5. The provider changes the type with
   Hetzner's hard `poweroff`, not a graceful shutdown: a power cut, so
   PostgreSQL must shut down cleanly first. Downtime for both environments
   starts here.

   ```bash
   systemctl stop wallandshadow-test wallandshadow-prod postgresql
   ```

   Everything starts again on boot, because the units are enabled. If the
   apply in the next step fails before the server powers off, start them
   again yourself:

   ```bash
   systemctl start postgresql wallandshadow-test wallandshadow-prod
   ```

4. Apply (apply on). The provider powers the server off, changes its type and
   powers it on: a few minutes of downtime. With `keep_disk = true` the root
   disk keeps its size, so you can always rescale back down.
5. Verify as in step 7 of the migration.

## Rebuilding

Rebuild when upgrading to a new Ubuntu LTS (change `server_image` in
`infra/terraform.tfvars` first), when the root disk is broken, or to rehearse
this procedure. Expect 10–15 minutes of downtime.

The Ubuntu LTS upgrade is untested: this path has only been exercised on
`ubuntu-24.04`. The old server is gone before Ansible has run on the new
image, and known risks on a newer release include the playbook's `apt_key`
tasks (newer apt drops `apt-key`), pgdg (the PostgreSQL apt repository)
support for the new codename, and PostgreSQL collation-version changes.
Rehearse on a throwaway server first. To roll back, revert `server_image` and
rebuild again; the volume is untouched. After an LTS rebuild, check the
collation versions **(on the server)**:

```bash
sudo -u postgres psql -Atc "SELECT datname, datcollversion, pg_database_collation_actual_version(oid) FROM pg_database WHERE datallowconn"
```

Reindex any database whose two versions differ, then record the new version:
`sudo -u postgres reindexdb <db>` and
`sudo -u postgres psql -c 'ALTER DATABASE <db> REFRESH COLLATION VERSION'`.

1. **(on the server, if it's reachable)** Run `/usr/local/bin/pg_backup.sh`
   and check for `Backup complete: …`. Note the user count
   (`sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'`).

   **(on your own machine)** Record the certificate serials with the serial
   check from [step 1 of the migration](#1-record-the-current-state).
2. Plan with **replace_server** on and apply off. Expect `hcloud_server.main`
   and `hcloud_volume_attachment.pgdata` to be replaced, and nothing else. In
   particular, the volume and both Primary IPs must be unchanged.
3. **(on the server)** Stop everything that uses the volume, and unmount it.
   The replacement destroys the volume attachment while the old server is
   still running, then deletes the server without shutting it down, so
   PostgreSQL and Caddy must have let go of the volume by then. Downtime
   starts here.

   ```bash
   systemctl stop wallandshadow-test wallandshadow-prod caddy postgresql && umount /mnt/pgdata
   ```

   If `umount` fails, `fuser -vm /mnt/pgdata` shows what still holds the
   volume. If the old server is running but unreachable over SSH, shut it
   down instead from the Hetzner Console (Servers → wallandshadow → Power →
   Shut down) before step 4 (the apply); if it's already dead there is
   nothing to stop. If the apply in the next step fails before the server is
   replaced, recover with:

   ```bash
   mount /mnt/pgdata && systemctl start postgresql caddy wallandshadow-test wallandshadow-prod
   ```

   If the apply had already detached the volume before it failed, `mount`
   fails harmlessly (and PostgreSQL stays stopped); in that case re-run the
   apply (replace_server and apply on) rather than starting services.

4. Run the workflow again with **replace_server** and **apply** on. OpenTofu
   destroys the old server and creates a new one with the same addresses and
   the volume attached. Ansible then mounts the volume, reuses the secrets on
   it, points PostgreSQL at the real data (checked before any database
   change) and gives Caddy its stored certificates.

   If the Ansible job fails (for example on an apt lock while the new server
   is still finishing its first boot), re-run with **apply** on and
   **replace_server off**. Leaving replace_server on would rebuild the server
   again.
5. Copy the `VPS_KNOWN_HOST` block printed at the end of the run into that
   secret in the `hetzner` environment. Deploys fail at SSH until you do.
6. **(on the server)** Start the applications. They come up on the last
   deployed images (`latest-test`, `latest-prod`):

   ```bash
   systemctl start wallandshadow-test wallandshadow-prod
   ```

7. Verify. **(on the server)**

   ```bash
   findmnt /mnt/pgdata
   systemctl is-active postgresql@17-main caddy wallandshadow-test wallandshadow-prod
   sudo -u postgres psql -Atc 'SHOW data_directory'
   sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'
   systemctl show -p RequiresMountsFor caddy.service postgresql@17-main.service
   curl -fsS https://wallandshadow.com/api/health; echo
   curl -fsS https://test.wallandshadow.com/api/health; echo
   ```

   Expect:

   - `findmnt` shows `/mnt/pgdata` on an ext4 device.
   - Four `active` lines.
   - `data_directory` is `/mnt/pgdata/main`.
   - The user count from step 1.
   - Two `RequiresMountsFor=` lines, each including `/mnt/pgdata`.
   - `{"ok":true}` twice.

   **(on your own machine)** Re-run the serial check. The serials must match
   the ones you recorded in step 1.

   After an Ubuntu LTS upgrade, also run the collation check above. Traffic
   stats and logs start again from empty.

## Package updates

unattended-upgrades installs updates once a day (Ubuntu's `apt-daily-upgrade`
timer: 06:00 server time plus up to an hour's random delay) and reboots at
04:30 when an update needs it. It takes:

- Ubuntu's own updates, security fixes included. Docker is Ubuntu's
  `docker.io` package, so it's covered too.
- PostgreSQL 17 minor releases, from the PostgreSQL repository. These are bug
  and security fixes that never change the data format. PostgreSQL 18 is a
  separate package (`postgresql-18`) that nothing installs; moving to it is a
  manual upgrade.
- Caddy patch releases within `caddy_series` in `ansible/vars/main.yml`
  (currently 2.11). An apt pin, `/etc/apt/preferences.d/caddy`, keeps it off
  newer series, because Caddy's minor releases can change behaviour.

A PostgreSQL or Caddy update restarts that service: a few seconds of dropped
connections. `/var/log/unattended-upgrades/unattended-upgrades.log` lists what
was installed.

Now and then a PostgreSQL release asks for a step after upgrading, usually
reindexing one kind of index. The
[release notes](https://www.postgresql.org/docs/release/) list it under
"Migration to Version 17.N".

### Moving Caddy to a new minor series

1. Read [Caddy's release notes](https://github.com/caddyserver/caddy/releases)
   for every release since the current series, looking for breaking changes
   and deprecations.
2. Change `caddy_series` in `ansible/vars/main.yml` in a PR. CI validates the
   Caddyfile against the new series' Docker image. Merge it.
3. Run the [provision workflow](#the-provision-workflow). It only moves the
   pin; unattended-upgrades installs the new series at its next run. To take
   it now instead, **(on the server)**:

   ```bash
   apt-get update && apt-get install --only-upgrade caddy
   ```

4. **(on the server)** Verify:

   ```bash
   caddy version
   systemctl is-active caddy
   curl -fsS https://wallandshadow.com/api/health; echo
   curl -fsS https://test.wallandshadow.com/api/health; echo
   ```

   Expect the new version, `active`, and `{"ok":true}` twice.

### Turning on PostgreSQL and Caddy updates (one-time)

Until this change, unattended-upgrades took only Ubuntu's own updates, so
PostgreSQL and Caddy are still the versions installed when the server was
built. The first update can jump several releases, so run it by hand while
you watch, straight after the provision run that turns updates on. Avoid
doing this between 06:00 and 07:00 server time, when the automatic run could
start first.

1. **(on the server)** Record what's installed:

   ```bash
   apt-get update
   apt-cache policy postgresql-17 caddy
   ```

   Expect Caddy `Installed: 2.11.2`. Note PostgreSQL's installed and candidate
   versions, then read its [release notes](https://www.postgresql.org/docs/release/)
   for every 17.x release after the installed one. Note any step their
   "Migration to Version 17.N" sections ask for.
2. **(on the server)** Back up:

   ```bash
   /usr/local/bin/pg_backup.sh
   ```

   Expect `Backup complete: …`.
3. Merge the PR, then run the [provision workflow](#the-provision-workflow):
   apply off, then on. Expect no OpenTofu changes. In the Ansible log, expect
   `changed` for `Pin Caddy to release series 2.11` and
   `Configure unattended-upgrades behaviour`.
4. **(on the server)** Check what the daily run will do, without doing it:

   ```bash
   apt-cache policy caddy | sed -n 1,3p
   unattended-upgrade --dry-run -d 2>&1 | grep -E '^(Allowed origins|Packages that will be upgraded)'
   ```

   Expect:

   - A Caddy candidate of `2.11.` something.
   - Allowed origins ending in `site=apt.postgresql.org, site=dl.cloudsmith.io`.
   - An upgrade list that includes `caddy`, and `postgresql-17` if step 1
     showed a newer candidate, alongside any pending Ubuntu updates.

   **Stop** if the candidate is outside 2.11: the pin isn't working.
5. **(on the server)** Run it. PostgreSQL and Caddy restart, so both
   environments drop connections for a few seconds.

   ```bash
   unattended-upgrade -v
   ```

6. **(on the server)** Verify:

   ```bash
   dpkg-query -W caddy postgresql-17
   sudo -u postgres psql -Atc 'SHOW server_version'
   systemctl is-active postgresql@17-main caddy wallandshadow-test wallandshadow-prod
   curl -fsS https://wallandshadow.com/api/health; echo
   curl -fsS https://test.wallandshadow.com/api/health; echo
   ```

   Expect:

   - Caddy on the newest 2.11 release.
   - `server_version` matching the `postgresql-17` package version, which
     shows the running cluster restarted onto the new release.
   - Four `active` lines.
   - `{"ok":true}` twice.

   Then carry out any post-upgrade steps you noted in step 1.

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

Not yet rehearsed; rehearse it with the scratch-database variant below before
you need it. The nightly dumps cover the production database only.

**(on the server)**

```bash
export AWS_ACCESS_KEY_ID=$(grep '^S3_ACCESS_KEY=' /mnt/pgdata/wallandshadow/secrets | cut -d= -f2-)
export AWS_SECRET_ACCESS_KEY=$(grep '^S3_SECRET_KEY=' /mnt/pgdata/wallandshadow/secrets | cut -d= -f2-)
aws s3 ls s3://wallandshadow-backups/db/ --endpoint-url https://hel1.your-objectstorage.com | tail -n 3
```

Pick the dump to restore (`DUMP=wallandshadow-YYYYMMDD-HHMMSS.sql.gz`), then
download it:

```bash
aws s3 cp "s3://wallandshadow-backups/db/$DUMP" /root/ --endpoint-url https://hel1.your-objectstorage.com
```

**Rehearsal** (leaves production alone): restore the dump into a scratch
database, compare the user count with production, then drop it.

```bash
sudo -u postgres createdb -O was wallandshadow_restore_check
gunzip -c "/root/$DUMP" | sudo -u postgres psql -v ON_ERROR_STOP=1 wallandshadow_restore_check
sudo -u postgres psql -d wallandshadow_restore_check -Atc 'SELECT count(*) FROM users'
sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'
sudo -u postgres dropdb wallandshadow_restore_check
```

Expect the restore to finish without an error and the two counts to match
(they can differ if accounts were created or deleted since the dump).

**Production restore** (replaces the live production database; downtime for
production until the last command):

```bash
systemctl stop wallandshadow-prod
sudo -u postgres dropdb wallandshadow
sudo -u postgres createdb -O was wallandshadow
gunzip -c "/root/$DUMP" | sudo -u postgres psql -v ON_ERROR_STOP=1 wallandshadow
systemctl start wallandshadow-prod
```
