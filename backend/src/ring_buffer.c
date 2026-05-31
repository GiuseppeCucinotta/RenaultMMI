#include "ring_buffer.h"
#include <linux/can.h>
#include <pthread.h>
#include <stdlib.h>

struct raw_frames_buffer_t {
  struct can_frame buf[N_FRAMES];
  int head, tail, count;
  pthread_mutex_t mutex;
};

void frame_put(raw_frames_buffer *b, struct can_frame frame) {
  b->buf[b->tail] = frame;
  b->tail = (b->tail) & (N_FRAMES - 1);
  b->count++;
}

struct can_frame frame_get(raw_frames_buffer *b) {
  struct can_frame frame = b->buf[b->head];

  b->head = (b->head + 1) & (N_FRAMES - 1);
  b->count--;

  return frame;
}

raw_frames_buffer *buf_init() {
  // TODO: Add checks
  raw_frames_buffer *b = malloc(sizeof(struct can_frame) * N_FRAMES +
                                sizeof(int) * 3 + sizeof(pthread_mutex_t));
  return b;
}
