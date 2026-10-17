// vscode-free check for the 32-bit glibc the CPN simulator needs on Linux, and the install command per distro.

export const LINUX_LOADER = '/lib/ld-linux.so.2';
const OSTREE_MARKER = '/run/ostree-booted';

export interface Glibc32Deps {
  /** True when the path exists. */
  exists: (p: string) => boolean;
  /** Contents of /etc/os-release, or undefined when unreadable. */
  readOsRelease: () => string | undefined;
}

export interface Glibc32Problem {
  /** Distro family the command was picked for. */
  family: 'debian' | 'fedora' | 'atomic' | 'opensuse' | 'arch' | 'unknown';
  /** Shell command to copy, if the distro is known. */
  command?: string;
  /** Extra remark to show next to the command. */
  note?: string;
}

/** Parse KEY=value lines of an os-release file (quotes stripped). */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)=(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** Distro family from ID first, then each ID_LIKE entry. */
function familyOf(ids: string[]): 'debian' | 'fedora' | 'opensuse' | 'arch' | undefined {
  for (const id of ids) {
    if (id === 'debian' || id === 'ubuntu') return 'debian';
    if (id === 'fedora' || id === 'rhel' || id === 'centos') return 'fedora';
    if (id === 'suse' || id === 'sles' || id.startsWith('opensuse')) return 'opensuse';
    if (id === 'arch') return 'arch';
  }
  return undefined;
}

/** Install command for the distro described by os-release text (empty when it could not be read). */
export function glibc32Install(osRelease: string, ostree = false): Glibc32Problem {
  const r = parseOsRelease(osRelease);
  const ids = [r.ID, ...(r.ID_LIKE ?? '').split(/\s+/)].filter((s): s is string => !!s).map((s) => s.toLowerCase());
  const atomic = ostree || ['silverblue', 'kinoite', 'sericea', 'onyx'].includes((r.VARIANT_ID ?? '').toLowerCase());
  const family = familyOf(ids);
  if (atomic && family === 'fedora') {
    return { family: 'atomic', command: 'rpm-ostree install glibc.i686', note: 'Reboot afterwards to apply it.' };
  }
  switch (family) {
    case 'debian':
      return { family, command: 'sudo dpkg --add-architecture i386 && sudo apt update && sudo apt install libc6:i386' };
    case 'fedora':
      return { family, command: 'sudo dnf install glibc.i686' };
    case 'opensuse':
      return { family, command: 'sudo zypper install glibc-32bit' };
    case 'arch':
      return { family, command: 'sudo pacman -S lib32-glibc', note: 'This needs the multilib repository enabled in /etc/pacman.conf.' };
    default:
      return { family: 'unknown' };
  }
}

/** undefined when the 32-bit loader is present, else what to tell the user. */
export function checkGlibc32(deps: Glibc32Deps): Glibc32Problem | undefined {
  if (deps.exists(LINUX_LOADER)) return undefined;
  return glibc32Install(deps.readOsRelease() ?? '', deps.exists(OSTREE_MARKER));
}

/** Error text for the failed state and the notification. */
export function glibc32Message(p: Glibc32Problem): string {
  const base = `The CPN simulator needs 32-bit glibc (${LINUX_LOADER}), which is missing.`;
  if (!p.command) {
    return `${base} Install your distribution's 32-bit glibc package (e.g. libc6:i386, glibc.i686 or lib32-glibc), or use the Docker backend.`;
  }
  return `${base} Install it with: ${p.command}.${p.note ? ` ${p.note}` : ''}`;
}
