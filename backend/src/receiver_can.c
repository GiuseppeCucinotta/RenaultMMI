#include "receiver_can.h"
#include "ring_buffer.h"

#include <asm-generic/errno.h>
#include <bits/types/struct_timeval.h>
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include <linux/can.h>
#include <pthread.h>
#include <sys/socket.h>

extern volatile sig_atomic_t keep_running;

// Bind the socekt to the vcan0
#include <net/if.h>

/* @brief Create an AF_CAN socket and binds it to a vcan0 if
 * @return can socket file descriptor */
// TODO: parametric can if name
static int init_can_socket() {
  int fd = socket(AF_CAN, SOCK_RAW, CAN_RAW);

  if (fd < 0) {
    perror("[!] Can't create CAN socket!\n");
    exit(1);
  }

  struct timeval tv;
  tv.tv_sec = 0;
  tv.tv_usec = 250;
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tv, sizeof(tv));

  unsigned int can_if_index = if_nametoindex("vcan0");
  if (can_if_index == 0) {
    perror("[!] Unable to get CAN interface index.\n");
    exit(1);
  }

  struct sockaddr_can addr_can = {
      .can_family = AF_CAN,
      .can_ifindex = can_if_index,
  };

  if (bind(fd, (struct sockaddr *)&addr_can, sizeof(addr_can)) < 0) {
    perror("[!] Can't bind CAN socket.\n");
    exit(1);
  }

  return fd;
}

/* @brief Reads a can_frame from sock_can_fd
 * @param[in] can socket file descriptor
 * @param[out] structure where it's saved the frame
 * @return 0 in case of no errors, -1 in case of a read error and -2 in case of
 * an incomplete frame
 * */
static int get_can_frame(int socket_fd, struct can_frame *cf) {
  int bytes_received = read(socket_fd, cf, sizeof(struct can_frame));

  if (bytes_received < 0)
    return -1;
  if ((size_t)bytes_received < sizeof(struct can_frame))
    return -2;

  return 0;
}

void *receiver_loop(void *b) {
  raw_frames_buffer *ring_buffer = (raw_frames_buffer *)b;
  int can_fd = init_can_socket();

  while (keep_running) {
    struct can_frame cf;
    int bytes = get_can_frame(can_fd, &cf);

    if (bytes == -1) {
      if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)
        continue;
      perror("Read error.\n");
      continue;
    }
    if (bytes == -2) {
      fprintf(stderr, "[!] Incomplete frame detected!\n");
      continue;
    }

    // Put frame into the buffer
    frame_put(ring_buffer, cf);
  }
  close(can_fd);
  return NULL;
}
