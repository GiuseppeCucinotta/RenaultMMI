#include <bits/pthreadtypes.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#include "receiver_can.h"
#include "ring_buffer.h"

int main(void) {

  raw_frames_buffer *ring_buffer = buf_init();

  pthread_t receiver_thread;

  if (pthread_create(&receiver_thread, NULL, receiver_loop, ring_buffer) < 0) {
    perror("[!] Unable to create the receiver thread\n");
    return 1;
  }

  // Temp reading with "busy waiting"
  // when there is no data, the main thread sleeps in frame_get
  printf("Reading Frames...\n");
  while (1) {
    struct can_frame frame = frame_get(ring_buffer);
    printf("ID can frame: %03X\n", frame.can_id);
  }
}
