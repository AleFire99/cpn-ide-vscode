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

Without it the canvas opens, but validation fails with *"the simulator could not start"*.
