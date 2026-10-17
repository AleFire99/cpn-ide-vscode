# 32-bit glibc on Linux

The CPN simulator is a 32-bit program. On a 64-bit Linux it needs the 32-bit C library:

**Debian / Ubuntu**

```sh
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install libc6:i386
```

**Fedora**

```sh
sudo dnf install glibc.i686
```

**openSUSE**

```sh
sudo zypper install glibc-32bit
```

**Arch** (needs the multilib repository)

```sh
sudo pacman -S lib32-glibc
```

**Fedora Silverblue / Kinoite** (reboot afterwards)

```sh
rpm-ostree install glibc.i686
```

If it is missing, the extension shows the right command for your distribution with a **Copy command** button. Without it the canvas opens, but validation fails with *"the simulator could not start"*.
