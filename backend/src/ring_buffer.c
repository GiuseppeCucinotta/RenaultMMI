#include "ring_buffer.h"
#include <bits/pthreadtypes.h>
#include <linux/can.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>

extern volatile sig_atomic_t keep_running;

struct raw_frames_buffer_t {
  struct can_frame buf[N_FRAMES];
  int head, tail, count;
  pthread_mutex_t mutex;
  pthread_cond_t not_full;
  pthread_cond_t not_empty;
};

void frame_put(struct raw_frames_buffer_t *b, struct can_frame frame) {

  pthread_mutex_lock(&b->mutex);
  while (b->count == N_FRAMES)
    pthread_cond_wait(&b->not_full, &b->mutex);

  b->buf[b->tail] = frame;
  b->tail = (b->tail + 1) & (N_FRAMES - 1);
  b->count++;

  pthread_cond_signal(&b->not_empty);
  pthread_mutex_unlock(&b->mutex);
}

struct can_frame frame_get(raw_frames_buffer *b) {

  pthread_mutex_lock(&b->mutex);
  while (b->count == 0 && keep_running)
    pthread_cond_wait(&b->not_empty, &b->mutex);

  if (!keep_running) {
    pthread_mutex_unlock(&b->mutex);
    struct can_frame empty_frame = {0};
    return empty_frame;
  }

  struct can_frame frame = b->buf[b->head];
  b->head = (b->head + 1) & (N_FRAMES - 1);
  b->count--;

  pthread_cond_signal(&b->not_full);
  pthread_mutex_unlock(&b->mutex);

  return frame;
}

raw_frames_buffer *buf_init() {

  raw_frames_buffer *b = calloc(1, sizeof(struct raw_frames_buffer_t));

  if (b != NULL) {

    /* pthread_mutex_init with NULL attribute on Linux is guaranteed that always
     * returns 0 */
    pthread_mutex_init(&b->mutex, NULL);

    if (pthread_cond_init(&b->not_empty, NULL) < 0) {
      printf("[!] Could not initialize 'not_empty' condition.\n");
      free(b);
      exit(1);
    }

    if (pthread_cond_init(&b->not_full, NULL) < 0) {
      printf("[!] Could not initialize 'not_full' condition.\n");
      free(b);
      exit(1);
    }
  }

  return b;
}

void buf_shutdown(raw_frames_buffer *b) {
  pthread_mutex_lock(&b->mutex);
  pthread_cond_broadcast(&b->not_empty);
  pthread_cond_broadcast(&b->not_full);
  pthread_mutex_unlock(&b->mutex);
}
