// Deploys a branch (default `pi`) to a Raspberry Pi over SSH. Runs on any machine with an
// ssh client (Windows 10+, macOS, Linux):
//   npm run deploy:pi
//   npm run deploy:pi -- --install-service   (first time: user service at login, desktop icon)
//   npm run deploy:pi -- --dry-run           (print the script it would run on the Pi)
// Settings come from the environment: PI_HOST (default pi@raspberrypi.local), PI_DIR (folder
// under the Pi's home, default organoid-analysis), PI_BRANCH (default pi). In PowerShell:
//   $env:PI_HOST = 'pi@192.168.1.20'; npm run deploy:pi
// It deploys what is pushed to origin, not the working tree, so it stops if the branch has
// unpushed commits. The first run clones the repo on the Pi; later runs fast-forward it.
// `npm ci` runs only when package-lock.json changed since the last install (it rebuilds
// serialport for ARM and downloads Electron, which takes minutes on a Pi). Then it restarts
// the organoid-analysis user service (scripts/pi/organoid-analysis.service) if installed.
import { execFileSync, spawnSync } from 'node:child_process';

const host = process.env.PI_HOST || 'pi@raspberrypi.local';
const dir = process.env.PI_DIR || 'organoid-analysis';
const branch = process.env.PI_BRANCH || 'pi';
const dryRun = process.argv.includes('--dry-run');
const installService = process.argv.includes('--install-service');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quote = s => `'${s.replace(/'/g, `'\\''`)}'`;

function fail(msg) {
    console.error(`deploy-pi: ${msg}`);
    process.exit(1);
}

const repo = git('remote', 'get-url', 'origin');
try {
    git('fetch', '--quiet', 'origin', branch);
} catch {
    fail(`origin has no branch '${branch}'; push it first: git push -u origin ${branch}`);
}
const hasLocal = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
if (hasLocal) {
    const unpushed = Number(git('rev-list', '--count', `origin/${branch}..refs/heads/${branch}`));
    if (unpushed > 0) fail(`${unpushed} unpushed commit(s) on ${branch}; the Pi pulls from origin, so git push first`);
}

const remote = [
    'set -euo pipefail',
    `BRANCH=${quote(branch)}; DIR=${quote(dir)}; REPO=${quote(repo)}; INSTALL_SERVICE=${installService ? 1 : 0}`,
    // ssh runs a non-interactive shell, which skips the nvm lines in .bashrc.
    'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi',
    'command -v node >/dev/null || { echo "Node.js not found on the Pi; install Node 22.18+ (NodeSource or nvm)"; exit 1; }',
    `node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' \\`,
    '    || { echo "Node $(node -v) on the Pi is too old; this project needs 22.18+"; exit 1; }',
    'cd "$HOME"',
    'if [ ! -d "$DIR/.git" ]; then git clone --branch "$BRANCH" "$REPO" "$DIR"; fi',
    'cd "$DIR"',
    'git fetch --quiet origin "$BRANCH"',
    'git checkout --quiet "$BRANCH"',
    'git merge --ff-only --quiet "origin/$BRANCH" || { echo "The Pi checkout has diverged from origin/$BRANCH; commit or discard its changes there"; exit 1; }',
    // The stamp is written only after a successful install, so a failed npm ci is retried next run.
    'LOCK=$(git hash-object package-lock.json)',
    'if [ "$(cat node_modules/.deploy-lock 2>/dev/null)" != "$LOCK" ]; then',
    '    echo "package-lock.json changed; running npm ci (slow on a Pi)"',
    '    npm ci',
    '    echo "$LOCK" > node_modules/.deploy-lock',
    'fi',
    'UNIT=organoid-analysis.service',
    'if [ "$INSTALL_SERVICE" = 1 ]; then',
    '    mkdir -p "$HOME/.config/systemd/user"',
    '    sed "s#%h/organoid-analysis#$PWD#" "scripts/pi/$UNIT" > "$HOME/.config/systemd/user/$UNIT"',
    '    systemctl --user daemon-reload',
    '    systemctl --user enable "$UNIT"',
    '    echo "Installed $UNIT. To start it at boot without logging in: sudo loginctl enable-linger $USER"',
    // Desktop icon and menu entry (scripts/pi/launch.sh): start the service if needed, open the page.
    '    APP=organoid-analysis.desktop',
    '    mkdir -p "$HOME/.local/share/applications" "$HOME/Desktop"',
    '    sed "s#__DIR__#$PWD#g" "scripts/pi/$APP" > "$HOME/.local/share/applications/$APP"',
    '    install -m 755 "$HOME/.local/share/applications/$APP" "$HOME/Desktop/$APP"',
    '    echo "Installed the Organoid Analysis icon on the Desktop and in the menu"',
    'fi',
    'if systemctl --user cat "$UNIT" >/dev/null 2>&1; then',
    '    systemctl --user restart "$UNIT"',
    '    echo "Restarted $UNIT (logs: journalctl --user -u $UNIT -f)"',
    'else',
    '    echo "No service installed. Start it on the Pi with: cd ~/$DIR && npm start  (or rerun with --install-service)"',
    'fi',
    'echo "Deployed $BRANCH at $(git log -1 --format=\'%h %s\')"',
].join('\n') + '\n';

if (dryRun) {
    console.log(`# would run on ${host}:\n${remote}`);
    process.exit(0);
}

console.log(`Deploying ${branch} to ${host}:~/${dir}`);
const ssh = spawnSync('ssh', [host, 'bash -s'], { input: remote, stdio: ['pipe', 'inherit', 'inherit'] });
if (ssh.error) fail(`could not run ssh: ${ssh.error.message}`);
process.exit(ssh.status ?? 1);
