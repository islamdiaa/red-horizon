# Test lab VMs

Two disposable libvirt VMs for testing the game on real operating systems and browsers that the
headless host tests never reach. Both sit on libvirt's NAT network `default`; from inside them the
host is the network's gateway (`192.168.122.1` on a stock libvirt install). VNC listens on
127.0.0.1 only, and autostart is off.

| VM | OS | Size | Login |
|---|---|---|---|
| `rh-test-ubuntu` | Ubuntu 24.04 cloud image | 2 vCPU, 4 GB, 30 GB disk ("low-end laptop") | `rhlab`, SSH key, passwordless sudo |
| `rh-test-win11` | Windows 11 Enterprise evaluation (90 days) | 4 vCPU, 6 GB, 64 GB disk, UEFI + TPM 2.0 | `rhadmin`, SSH key (PowerShell), signs in to the desktop automatically |

Installed on both: Google Chrome (stable), Firefox (stable), Node LTS and Playwright (the repo's
version) with its Chromium, Firefox and WebKit builds. Windows also has Edge; Ubuntu also has
xvfb and `tc` (iproute2) for netem. Neither VM has a GPU: Windows renders through Direct3D 11 WARP
(the "Microsoft Basic Render Driver"), Ubuntu through SwiftShader or llvmpipe.

## Setup

Copy `.env.example` to `.env` (git-ignored) and point it at the secrets folder, the disk folder and
the install media. The secrets folder (mode 700) holds the lab SSH key `lab_ed25519` and the two
account passwords; `lab.sh` also writes the generated cloud-init seed and Windows answer ISO there,
because they contain the passwords. Nothing secret lives in this folder.

```sh
tools/lab/lab.sh build ubuntu      # disk from the cloud image + cloud-init seed, define, boot (~1 min)
tools/lab/lab.sh provision ubuntu  # browsers, Node, Playwright (~10 min)
tools/lab/lab.sh snapshot ubuntu clean

tools/lab/lab.sh build win11       # fully unattended install from the ISO (~25 min to SSH)
tools/lab/lab.sh provision win11   # waits for SSH, then browsers, Node, Playwright (~5 min)
tools/lab/lab.sh snapshot win11 clean
```

The Windows install uses `win11/autounattend.xml.tmpl` on a small generated ISO (`mkiso.py`, so no
mkisofs is needed): VirtIO storage and network drivers from the virtio-win ISO, the documented
`LabConfig` bypass keys (the host's OVMF build has no enrolled Secure Boot keys, so Secure Boot is
off; the TPM is a real swtpm 2.0), BitLocker auto-encryption off, and a local admin account. At
first sign-in `win11/setup.ps1` installs the VirtIO guest tools and agent, and OpenSSH Server
(key-only, `administrators_authorized_keys`, PowerShell as the default shell); turns off sleep,
the lock screen, account lockout, and automatic Windows Update installs and reboots; and keeps
automatic sign-in on, including after a sign-out.

## Everyday use

```sh
tools/lab/lab.sh status                       # state, IP, vCPUs, autostart, snapshots
tools/lab/lab.sh up ubuntu                    # memguard (RAM + 6000 MB), start, wait for SSH
tools/lab/lab.sh down win11                   # clean shutdown (forced after 4 minutes)
tools/lab/lab.sh ssh ubuntu 'tc qdisc show'   # one command, or no command for a shell
tools/lab/lab.sh copy win11 ./x.mjs C:/lab/   # host -> VM; ':C:/lab/out' as source copies back
tools/lab/lab.sh snapshot ubuntu before-soak  # offline: disk + UEFI vars + TPM state (~1 min)
tools/lab/lab.sh revert ubuntu clean          # powers the VM off hard, restores, restarts
tools/lab/lab.sh screen win11 /tmp/win.png    # console screenshot (handy during the install)
tools/lab/lab.sh display win11 1920x1080 150  # Windows resolution and scaling (signs out and back in)
tools/lab/lab.sh cpus ubuntu 4                # e.g. lift the "low-end laptop" to 4 vCPUs; restart to apply
```

Shut the VMs down when they are idle; they reserve their RAM while running.

## Running Playwright scripts in a VM

```sh
tools/lab/lab.sh run ubuntu tools/lab/smoke.mjs                    # chromium,chrome,firefox,moz-firefox,webkit
tools/lab/lab.sh run win11 tools/lab/smoke.mjs chrome,msedge       # headless, from the SSH session
LAB_DESKTOP=1 tools/lab/lab.sh run win11 tools/lab/webgl-probe.mjs # headed, in the signed-in desktop
```

`run` copies the script and its sibling `.mjs`/`.js`/`.json` files into the VM's Playwright folder
(`~/pw/jobs/<dir>/` or `C:\lab\pw\jobs\<dir>\`, so `import 'playwright'` resolves), runs it with
`GAME_URL` (default: the gateway on port 8091; override with `LAB_GAME_URL`) and `OUT_DIR` set,
and copies `OUT_DIR` back to `$LAB_OUT/<vm>/<script>-<time>/`. On Ubuntu it runs under `xvfb-run`,
so headed browsers work too. On Windows the SSH session is session 0 (no desktop); `LAB_DESKTOP=1`
runs the script through a scheduled task in the signed-in user's desktop session with `HEADED=1`.

Browser names in the scripts: `chromium` (Playwright's build), `chrome`, `msedge` (installed
browsers), `firefox` (Playwright's patched build) and `moz-firefox` (the installed stock Firefox,
driven over WebDriver BiDi; on Windows pass `args: ['-wait-for-browser']`, because the stock
`firefox.exe` is a launcher that hands off to another process and exits).

- `smoke.mjs`: loads the menu, starts a skirmish (`?autostart=1`), screenshots both, and records
  the WebGL renderer, frame rate, draw calls and console errors.
- `webgl-probe.mjs`: a matrix of Chromium flags and Firefox prefs, recording whether each gives
  WebGL2 and on which backend (with the `chrome://gpu` renderer for Chromium browsers).

## WebGL on the GPU-less Windows VM

| Browser and flags | Result |
|---|---|
| Chrome / Edge, no flags | WebGL2 on SwiftShader (WARP is blocklisted) |
| Chrome / Edge `--ignore-gpu-blocklist` or `--use-angle=d3d11-warp` | WebGL2 on Direct3D 11 WARP (ANGLE's HLSL path) |
| Chrome / Edge `--use-angle=d3d11` alone | no WebGL at all |
| Firefox, default prefs | WebGL1 only, no WebGL2 |
| Firefox `webgl.force-enabled = true` | WebGL2 on Direct3D 11 WARP |

Headless and headed runs give the same results. Chrome logs one failed Windows logon per launch
from an SSH session (it probes for a blank OS password), which is why account lockout is off in
the VM.
