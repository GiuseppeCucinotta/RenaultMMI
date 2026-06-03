#include <bits/pthreadtypes.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#include "can_decoder.h"
#include "receiver_can.h"
#include "ring_buffer.h"

#define WORKERS 4

void print_intro() {
  puts(" ____                        _ _   __  __ __  __ ___ ");
  puts("|  _ \\ ___ _ __   __ _ _   _| | |_|  \\/  |  \\/  |_ _|");
  puts("| |_) / _ \\ '_ \\ / _` | | | | | __| |\\/| | |\\/| || | ");
  puts("|  _ <  __/ | | | (_| | |_| | | |_| |  | | |  | || |");
  puts("|_| \\_\\___|_| |_|\\__,_|\\__,_|_|\\__|_|  |_|_|  |_|___|");
  puts("-------------------------------------------------------------");
  puts("© 2026 - Giuseppe Cucinotta\n");
}

int main(void) {
  print_intro();
  printf("[*] Initializing system...\n");

  raw_frames_buffer *ring_buffer = buf_init();

  pthread_t receiver_thread;

  if (pthread_create(&receiver_thread, NULL, receiver_loop, ring_buffer) < 0) {
    perror("[!] Unable to create the receiver thread.\n");
    return 1;
  }

  printf("[*] Created receiver thread!\n");

  decoder_init();

  pthread_t decoders[WORKERS];
  for (int i = 0; i < WORKERS; i++) {
    if (pthread_create(&decoders[i], NULL, decoder_loop, ring_buffer) < 0) {
      perror("[!] Unable to create %d decoder thread.\n");
      return 1;
    }
  }

  pthread_join(receiver_thread, NULL);
  pthread_join(decoders[0], NULL);
  pthread_join(decoders[1], NULL);
  pthread_join(decoders[2], NULL);
  pthread_join(decoders[3], NULL);

  printf("[*] Created decoders threads!\n");

  return 0;
}
