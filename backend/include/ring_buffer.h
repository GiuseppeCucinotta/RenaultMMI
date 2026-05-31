#pragma once
#include <linux/can.h>

#define N_FRAMES 4096

/* Ring buffer of raw can frames */
typedef struct raw_frames_buffer_t raw_frames_buffer;

/* @brief Utility function to put a frame into the ring buffer. It uses
 * wrap-around logic
 * @param[in, out] Pointer to the struct buffer
 * @param[in] The frame to write inside the buffer
 * */
void frame_put(raw_frames_buffer *b, struct can_frame frame);

/* @brief Utility function to get the last frame from the ring buffer. It uses
 * wrap-around logic
 * @param[in] Pointer to the struct buffer
 * */
struct can_frame frame_get(raw_frames_buffer *b);

/* @brief Initialize the mutex and condition variables;
 * Allocate the struct with malloc.
 * @return Pointer to the struct.
 */
raw_frames_buffer *buf_init();
