# 1. Recorded State

As per SERVER_OPERATIONS.md.

## Server State

```
root@wallandshadow:~# findmnt /mnt/pgdata 
TARGET      SOURCE   FSTYPE OPTIONS
/mnt/pgdata /dev/sdb ext4   rw,relatime,discard
root@wallandshadow:~# sudo -u postgres psql -Atc 'SHOW data_directory'
/mnt/pgdata/main
root@wallandshadow:~# df -h / /mnt/       
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        38G  3.4G   33G  10% /
/dev/sda1        38G  3.4G   33G  10% /
root@wallandshadow:~# df -h / /mnt/pgdata/
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        38G  3.4G   33G  10% /
/dev/sdb        9.8G   73M  9.2G   1% /mnt/pgdata
root@wallandshadow:~# ls -la /mnt/pgdata/ /etc/wallandshadow/
/etc/wallandshadow/:
total 48
drwx------   2 root root 4096 May 25 14:10 .
drwxr-xr-x 111 root root 4096 Sep 12 06:24 ..
-rw-------   1 root root  259 Apr 13 21:16 root@wallandshadow:~# tail -n 3 /var/log/pgbackup.log
tail: cannot open '/var/log/pgbackup.log' for reading: No such file or directorycors-wallandshadow-prod.json
-rw-------   1 root root  264 Apr 13 21:16 cors-wallandshadow-test.json
-rw-r--r--   1 root root 1142 May 25 14:09 goaccess.conf
-rw-------   1 root root 1029 May 25 14:10 prod.env
-rw-r--r--   1 root root   84 Sep 12 11:16 prod.image
-rw-------   1 root root 1118 May  4 12:00 secrets
-rw-------   1 root root  906 Apr 13 22:22 secrets.bak.1776118970
-rw-------   1 root root  906 Apr 13 22:25 secrets.bak.1776119112
-rw-------   1 root root 1034 May 25 14:09 test.env
-rw-r--r--   1 root root   84 Sep 12 10:51 test.image

/mnt/pgdata/:
total 28
drwx------  4 postgres postgres  4096 Apr 13 20:40 .
drwxr-xr-x  4 root     root      4096 Apr 13 20:40 ..
drwx------  2 root     root     16384 Apr 13 20:23 lost+found
drwx------ 19 postgres postgres  4096 Sep 13 04:30 main
root@wallandshadow:~# ls /var/lib/caddy/.local/share/caddy/certificates/*/
test.wallandshadow.com  wallandshadow.com  www.wallandshadow.com
root@wallandshadow:~# sudo -u postgres psql -d wallandshadow -Atc 'SELECT count(*) FROM users'
5
root@wallandshadow:~# tail -n 3 /var/log/     
alternatives.log       btmp.1                 dpkg.log.3.gz          pg_backup.log.12.gz    pg_backup.log.26.gz    README
alternatives.log.1     caddy/                 dpkg.log.4.gz          pg_backup.log.13.gz    pg_backup.log.27.gz    syslog
alternatives.log.2.gz  cloud-init.log         dpkg.log.5.gz          pg_backup.log.14.gz    pg_backup.log.28.gz    syslog.1
alternatives.log.3.gz  cloud-init.log.1       faillog                pg_backup.log.15.gz    pg_backup.log.29.gz    syslog.2.gz
alternatives.log.4.gz  cloud-init-output.log  journal/               pg_backup.log.16.gz    pg_backup.log.2.gz     syslog.3.gz
alternatives.log.5.gz  dist-upgrade/          kern.log               pg_backup.log.17.gz    pg_backup.log.30.gz    syslog.4.gz
apport.log             dmesg                  kern.log.1             pg_backup.log.18.gz    pg_backup.log.3.gz     sysstat/
apt/                   dmesg.0                kern.log.2.gz          pg_backup.log.19.gz    pg_backup.log.4.gz     ufw.log
auth.log               dmesg.1.gz             kern.log.3.gz          pg_backup.log.1.gz     pg_backup.log.5.gz     ufw.log.1
auth.log.1             dmesg.2.gz             kern.log.4.gz          pg_backup.log.20.gz    pg_backup.log.6.gz     ufw.log.2.gz
auth.log.2.gz          dmesg.3.gz             landscape/             pg_backup.log.21.gz    pg_backup.log.7.gz     unattended-upgrades/
auth.log.3.gz          dmesg.4.gz             lastlog                pg_backup.log.22.gz    pg_backup.log.8.gz     wtmp
auth.log.4.gz          dpkg.log               pg_backup.log          pg_backup.log.23.gz    pg_backup.log.9.gz     
bootstrap.log          dpkg.log.1             pg_backup.log.10.gz    pg_backup.log.24.gz    postgresql/            
btmp                   dpkg.log.2.gz          pg_backup.log.11.gz    pg_backup.log.25.gz    private/               
root@wallandshadow:~# tail -n 3 /var/log/pg_backup.log
upload: ../tmp/wallandshadow-20260913-030001.sql.gz to s3://wallandshadow-backups/db/wallandshadow-20260913-030001.sql.gz
Backup complete: wallandshadow-20260913-030001.sql.gz
root@wallandshadow:~# 
```

## Certificate serials

```
alex@baldur:~$ for h in wallandshadow.com test.wallandshadow.com; do
  echo | openssl s_client -connect "$h:443" -servername "$h" 2>/dev/null \
    | openssl x509 -noout -serial -enddate
done
serial=065A1568F3B19ACC2AF9B80EED391C16A040
notAfter=Nov 11 05:21:50 2026 GMT
serial=063A137AEAC0ED4DCAD76FFF66DFB7A8B3BD
notAfter=Nov  9 10:41:50 2026 GMT
alex@baldur:~$ 
```

# 2. Back Up

Production database nightly backup confirmed to be working correctly (into blob storage). Rest backed up into filen at backup/wallandshadow-misc-backup-20260913 .

Server snapshot created: wallandshadow-1789296734 -- ID: 431447948. (After this whole process is complete, I can delete it again.)

# 6. Verify

Everything checks out. The serials match (log not pasted.)

```
root@wallandshadow:~# ls -la /mnt/pgdata/
total 36
drwxr-xr-x  6 root     root      4096 Sep 13 11:08 .
drwxr-xr-x  4 root     root      4096 Apr 13 20:40 ..
drwx------  4 caddy    caddy     4096 Sep 12 04:30 caddy
drwx------  2 root     root     16384 Apr 13 20:23 lost+found
drwx------ 19 postgres postgres  4096 Sep 13 04:30 main
drwx------  2 root     root      4096 Sep 13 11:07 wallandshadow
<pgdata/wallandshadow/secrets) && echo "secrets unchanged" || echo "SECRETS DIFFER — stop"
secrets unchanged
root@wallandshadow:~# test ! -e /etc/wallandshadow/secrets && echo "legacy secrets file removed"
legacy secrets file removed
root@wallandshadow:~# ls /mnt/pgdata/caddy/certificates/*/
test.wallandshadow.com  wallandshadow.com  www.wallandshadow.com
root@wallandshadow:~# systemctl show -p RequiresMountsFor caddy.service postgresql@17-main.service
WARNING: terminal is not fully functional
Press RETURN to continue 
RequiresMountsFor=/var/tmp /mnt/pgdata

RequiresMountsFor=/mnt/pgdata /var/lib/postgresql/17/main /etc/postgresql/17/main
root@wallandshadow:~# journalctl -u caddy --since '-30 min' | grep -iE 'obtain|error' || echo "no certificate requests or errors"
no certificate requests or errors
root@wallandshadow:~# curl -fsS https://wallandshadow.com/api/health; echo
{"ok":true}
root@wallandshadow:~# curl -fsS https://test.wallandshadow.com/api/health; echo
{"ok":true}
```

# 7. Reboot test

Everything also checks out.

# 8. Tidy up, after a week

(Leaving this section blank and setting myself a reminder for 2026-09-20).
