#include "receiver_can.h"
#include "ring_buffer.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include <linux/can.h>
#include <pthread.h>
#include <sys/socket.h>

pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;

static int init_can_socket() {
  int fd = socket(AF_CAN, SOCK_STREAM, 0);

  if (fd < 0) {
    perror("Socket not created; error occured.\n");
    exit(1);
  }

  return fd;
}

static int get_can_frame(int socket_fd, struct can_frame *cf) {
  int bytes_received = read(socket_fd, cf, sizeof(struct can_frame));

  if (bytes_received < 0)
    return -1;
  if ((size_t)bytes_received < sizeof(struct can_frame))
    return -2;

  return 0;
}

// TODO: add the void struct frame buffer
void *receiver_loop(void *b) {
  int can_fd = init_can_socket();

  raw_frames_buffer *buffer = (raw_frames_buffer *)b;

  while (1) {
    struct can_frame cf;
    int bytes = get_can_frame(can_fd, &cf);

    if (bytes == -1) {
      perror("Read error.\n");
      continue;
    }
    if (bytes == -2) {
      fprintf(stderr, "[!] Incomplete frame detected!\n");
      continue;
    }

    pthread_mutex_lock(&mutex);
    // TODO: condition variables !
    frame_put(buffer, cf);
    pthread_mutex_unlock(&mutex);
  }
}
