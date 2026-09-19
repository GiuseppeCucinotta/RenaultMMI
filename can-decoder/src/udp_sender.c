#include "udp_sender.h"
#include "can_decoder.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

extern volatile sig_atomic_t keep_running;

/* @brief Create an UDP socket that works on PORT
 * @return 1 if it's unable to create the socket
 * @return 2 if it's unable to bind the socket
 */
static int create_udp_socket() {
  int udp_fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (udp_fd < 0) {
    perror("[!] Can't create UDP socket!\n");
    return 1;
  }
  return udp_fd;
}

void *udp_loop() {
  int udp_fd = create_udp_socket();
  if (udp_fd == 1)
    exit(EXIT_FAILURE);

  struct sockaddr_in local_backend_addr;
  local_backend_addr.sin_family = AF_INET;
  local_backend_addr.sin_port = htons(PORT);
  inet_pton(AF_INET, "127.0.0.1", &local_backend_addr.sin_addr);

  VehicleState local_snapshot;
  while (keep_running) {
    pthread_mutex_lock(&global_vehicle.mutex);
    memcpy(&local_snapshot, &global_vehicle.state, sizeof(VehiclePayloadState));
    pthread_mutex_unlock(&global_vehicle.mutex);

    sendto(udp_fd, &local_snapshot, sizeof(VehiclePayloadState), 0,
           (struct sockaddr *)&local_backend_addr, sizeof(local_backend_addr));

    usleep(N60_REFRESH_MS);
  }
  close(udp_fd);
  return NULL;
}
