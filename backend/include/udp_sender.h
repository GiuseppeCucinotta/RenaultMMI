#pragma once

#define _DEFAULT_SOURCE
#include <netinet/in.h>
#include <pthread.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <sys/socket.h>
#include <unistd.h>

#define PORT 4000
#define N60_REFRESH_MS 16666

/* @brief Create UDP socket via an internal function and send to localhost:4000
 * a snapshot to VehicleState */
void *udp_loop();
