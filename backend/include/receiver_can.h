#pragma once
#include <linux/can.h>

#define N_FRAMES 4096

/* @brief Create an AF_CAN socket and returns it's file descriptor
 * @return can socket file descriptor */
static int init_can_socket();

/* @brief Reads a can_frame from sock_can_fd
 * @param[in] can socket file descriptor
 * @param[out] structure where it's saved the frame
 * @return 0 in case of no errors, -1 in case of a read error and -2 in case of
 * an incomplete frame
 * */
static int get_can_frame(int socket_fd, struct can_frame *cf);

/* @brief it's the receiver thread main function (reads the frame and put it
 * into the buffer) */
void *receiver_loop(void *b);
