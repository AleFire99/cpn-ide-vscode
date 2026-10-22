// LD_PRELOAD shim for the 32-bit CPN simulator (cpnmld, run.x86-linux).
//
// Their i386 glibc implements socket(), bind(), ... through the legacy socketcall(2) multiplexer, which Docker's
// default seccomp profile no longer allows (Docker >= 29: ENOSYS). The direct i386 socket syscalls (Linux >= 4.3)
// are still allowed, so route every socket call through them. See issue #119.
#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

// i386 syscall numbers (arch/x86/entry/syscalls/syscall_32.tbl).
enum {
  NR_SOCKET = 359, NR_SOCKETPAIR = 360, NR_BIND = 361, NR_CONNECT = 362, NR_LISTEN = 363, NR_ACCEPT4 = 364,
  NR_GETSOCKOPT = 365, NR_SETSOCKOPT = 366, NR_GETSOCKNAME = 367, NR_GETPEERNAME = 368, NR_SENDTO = 369,
  NR_SENDMSG = 370, NR_RECVFROM = 371, NR_RECVMSG = 372, NR_SHUTDOWN = 373,
};

int socket(int d, int t, int p) { return syscall(NR_SOCKET, d, t, p); }
int socketpair(int d, int t, int p, int sv[2]) { return syscall(NR_SOCKETPAIR, d, t, p, sv); }
int bind(int s, const struct sockaddr *a, socklen_t l) { return syscall(NR_BIND, s, a, l); }
int connect(int s, const struct sockaddr *a, socklen_t l) { return syscall(NR_CONNECT, s, a, l); }
int listen(int s, int b) { return syscall(NR_LISTEN, s, b); }
int accept4(int s, struct sockaddr *a, socklen_t *l, int f) { return syscall(NR_ACCEPT4, s, a, l, f); }
int accept(int s, struct sockaddr *a, socklen_t *l) { return syscall(NR_ACCEPT4, s, a, l, 0); }
int getsockopt(int s, int lv, int n, void *v, socklen_t *l) { return syscall(NR_GETSOCKOPT, s, lv, n, v, l); }
int setsockopt(int s, int lv, int n, const void *v, socklen_t l) { return syscall(NR_SETSOCKOPT, s, lv, n, v, l); }
int getsockname(int s, struct sockaddr *a, socklen_t *l) { return syscall(NR_GETSOCKNAME, s, a, l); }
int getpeername(int s, struct sockaddr *a, socklen_t *l) { return syscall(NR_GETPEERNAME, s, a, l); }
ssize_t sendto(int s, const void *b, size_t n, int f, const struct sockaddr *a, socklen_t l) { return syscall(NR_SENDTO, s, b, n, f, a, l); }
ssize_t send(int s, const void *b, size_t n, int f) { return syscall(NR_SENDTO, s, b, n, f, 0, 0); }
ssize_t sendmsg(int s, const struct msghdr *m, int f) { return syscall(NR_SENDMSG, s, m, f); }
ssize_t recvfrom(int s, void *b, size_t n, int f, struct sockaddr *a, socklen_t *l) { return syscall(NR_RECVFROM, s, b, n, f, a, l); }
ssize_t recv(int s, void *b, size_t n, int f) { return syscall(NR_RECVFROM, s, b, n, f, 0, 0); }
ssize_t recvmsg(int s, struct msghdr *m, int f) { return syscall(NR_RECVMSG, s, m, f); }
int shutdown(int s, int h) { return syscall(NR_SHUTDOWN, s, h); }
