#pragma once
#include <linux/can.h>

#define N_FRAMES 4096

/* @brief it's the receiver thread main function (reads the frame and put it
 * into the buffer) */
void *receiver_loop(void *b);
