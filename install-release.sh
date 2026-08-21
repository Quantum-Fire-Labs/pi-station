#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Pi Station installer: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v node >/dev/null 2>&1 || fail "Node.js 22.19 or newer is required"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' || \
  fail "Node.js 22.19 or newer is required; found $(node -p 'process.versions.node')"

case "$(uname -s)" in
  Linux) platform=linux; platform_installer=install.sh; checksum_command=sha256sum ;;
  Darwin) platform=macos; platform_installer=install-macos.sh; checksum_command=shasum ;;
  *) fail "only Linux and macOS are supported" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) architecture=x64 ;;
  arm64|aarch64) architecture=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac
command -v "$checksum_command" >/dev/null 2>&1 || fail "$checksum_command is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

installed_pi=false
if ! command -v pi >/dev/null 2>&1; then
  if [[ "${PI_STATION_SKIP_PI_INSTALL:-0}" == "1" ]]; then
    printf 'Pi is not installed; continuing because PI_STATION_SKIP_PI_INSTALL=1.\n' >&2
  else
    command -v npm >/dev/null 2>&1 || fail "npm is required to install Pi"
    pi_prefix=${PI_STATION_PI_INSTALL_PREFIX:-"$HOME/.local"}
    printf 'Pi is not installed. Installing it for the current user...\n'
    npm install --global --prefix "$pi_prefix" --ignore-scripts @earendil-works/pi-coding-agent
    export PATH="$pi_prefix/bin:$PATH"
    hash -r
    command -v pi >/dev/null 2>&1 || fail "Pi was installed, but $pi_prefix/bin is not available"
    installed_pi=true
  fi
fi

repository=${PI_STATION_REPOSITORY:-Quantum-Fire-Labs/pi-station}
api_root=${PI_STATION_GITHUB_API_URL:-https://api.github.com}
if [[ -n "${PI_STATION_VERSION:-}" ]]; then
  tag=$PI_STATION_VERSION
  [[ "$tag" == v* ]] || tag="v$tag"
  encoded_tag=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$tag")
  release_url="$api_root/repos/$repository/releases/tags/$encoded_tag"
else
  release_url="$api_root/repos/$repository/releases/latest"
fi

printf 'Finding the Pi Station release for %s %s...\n' "$platform" "$architecture"
release_json=$(curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --header 'Accept: application/vnd.github+json' --header 'User-Agent: pi-station-installer' "$release_url") || \
  fail "could not find the requested GitHub release"
asset_data=$(printf '%s' "$release_json" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const release = JSON.parse(input);
  const suffix = `-${process.argv[1]}-${process.argv[2]}.tar.gz`;
  const archives = release.assets.filter((asset) => asset.name.startsWith("pi-station-") && asset.name.endsWith(suffix));
  if (archives.length !== 1) throw new Error(`expected one release asset ending in ${suffix}`);
  const archive = archives[0];
  const checksum = release.assets.find((asset) => asset.name === `${archive.name}.sha256`);
  if (checksum === undefined) throw new Error(`missing checksum for ${archive.name}`);
  process.stdout.write([archive.name, archive.browser_download_url, checksum.name, checksum.browser_download_url].join("\t"));
});
' "$platform" "$architecture") || fail "the GitHub release does not contain the required artifact and checksum"
IFS=$'\t' read -r archive_name archive_url checksum_name checksum_url <<< "$asset_data"

work_directory=$(mktemp -d "${TMPDIR:-/tmp}/pi-station-install.XXXXXX")
trap 'rm -rf -- "$work_directory"' EXIT
printf 'Downloading %s...\n' "$archive_name"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --output "$work_directory/$archive_name" "$archive_url"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --output "$work_directory/$checksum_name" "$checksum_url"
(
  cd "$work_directory"
  if [[ "$checksum_command" == sha256sum ]]; then
    sha256sum --check "$checksum_name"
  else
    shasum -a 256 --check "$checksum_name"
  fi
)

release_directory="$work_directory/release"
mkdir -p "$release_directory"
tar -xzf "$work_directory/$archive_name" -C "$release_directory"
[[ -x "$release_directory/$platform_installer" ]] || fail "the release does not contain $platform_installer"
printf 'Installing Pi Station...\n'
"$release_directory/$platform_installer"
if [[ "$installed_pi" == true ]]; then
  printf '\nPi was installed at %s. Run `pi` and use `/login` to connect a model provider.\n' "$(command -v pi)"
fi
