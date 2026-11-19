#!/usr/bin/env bash
# Run on the existing production host after uploading the static archive.
set -Eeuo pipefail
release=${1:?release ID required}
archive=${2:?archive path required}
expected_sha=${3:?archive SHA256 required}
[[ "$release" =~ ^[0-9]{8}-[0-9]{6}-[a-f0-9]{7,40}$ ]] || { echo 'Invalid release ID'; exit 1; }
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c -
base=/opt/wanderlust-site
config=/etc/nginx/conf.d/ziyou.1work.vip.conf
backup="$base/backups/$release"
target="$base/releases/$release"
[[ ! -e "$target" && ! -e "$backup" ]] || { echo "Release already exists"; exit 1; }
mkdir -p "$backup" "$target" /var/www/letsencrypt
# No database, container, environment file or other virtual host is changed.
tar -czf "$backup/nginx-before.tar.gz" -C /etc/nginx conf.d
if [[ -f "$config" ]]; then cp -a "$config" "$backup/site-before.conf"; fi
previous=$(readlink "$base/current" || true)
printf '%s\n' "$previous" > "$backup/previous-release.txt"
tar -xzf "$archive" -C "$target"
[[ -s "$target/site/index.html" && -s "$target/site/version.json" ]]
rollback() {
    code=$?
    trap - ERR
    if [[ -f "$backup/site-before.conf" ]]; then cp -a "$backup/site-before.conf" "$config"; else rm -f "$config"; fi
    if [[ -n "$previous" ]]; then ln -sfn "$previous" "$base/rollback-link"; mv -Tf "$base/rollback-link" "$base/current"; else rm -f "$base/current"; fi
    nginx -t && nginx -s reload || true
    echo "Deployment failed; site configuration restored. Backup: $backup" >&2
    exit "$code"
}
trap rollback ERR
if [[ ! -f /etc/letsencrypt/live/ziyou.1work.vip/fullchain.pem ]]; then
    cat > "$config" <<'HTTP'
server {
    listen 80;
    server_name ziyou.1work.vip;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; default_type text/plain; }
    location / { return 503; }
}
HTTP
    nginx -t
    nginx -s reload
    certbot certonly --webroot -w /var/www/letsencrypt --cert-name ziyou.1work.vip -d ziyou.1work.vip --non-interactive --agree-tos --email gaogg521@163.com
fi
cp "$target/ops/ziyou.1work.vip.conf" "$config"
ln -sfn "$target/site" "$base/next-link"
mv -Tf "$base/next-link" "$base/current"
chmod -R a+rX "$target"
if command -v selinuxenabled >/dev/null && selinuxenabled; then chcon -R -t httpd_sys_content_t "$base/releases"; fi
nginx -t
nginx -s reload
curl --fail --silent --show-error --resolve ziyou.1work.vip:443:127.0.0.1 https://ziyou.1work.vip/version.json
printf '\nRelease: %s\nBackup: %s\nPrevious: %s\n' "$release" "$backup" "$previous"
