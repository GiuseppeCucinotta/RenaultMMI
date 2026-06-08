#include <bits/pthreadtypes.h>
#include <pthread.h>
#include <stdio.h>

#include "can_decoder.h"
#include "receiver_can.h"
#include "ring_buffer.h"
#include "udp_sender.h"

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

  pthread_t receiver_thread, udp_sender;

  if (pthread_create(&receiver_thread, NULL, receiver_loop, ring_buffer) < 0) {
    perror("[!] Unable to create the receiver thread.\n");
    return 1;
  }

  printf("[*] Created receiver thread!\n");

  decoder_init();

  pthread_t decoders[WORKERS];
  for (int i = 0; i < WORKERS; i++) {
    if (pthread_create(&decoders[i], NULL, decoder_loop, ring_buffer) < 0) {
      perror("[!] Unable to create decoder thread.\n");
      return 1;
    }
  }

  printf("[*] Created decoders threads!\n");

  if (pthread_create(&udp_sender, NULL, *udp_loop, NULL) < 0) {
    perror("[!] Unable to create UDP thread.\n");
    return 1;
  }

  printf("[*] Created UDP thread!\n");

  pthread_join(udp_sender, NULL);
  pthread_join(receiver_thread, NULL);
  for (int i = 0; i < WORKERS; i++) {
    pthread_join(decoders[i], NULL);
  }

  return 0;
}
