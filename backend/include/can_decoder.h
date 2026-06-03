#pragma once
#include <linux/can.h>
#include <pthread.h>
#include <stdbool.h>

#define CAN_11B_IDS 2048

typedef struct {
  // Engine data
  double engine_rpm;

  // Brakes data
  bool parking_brake;

  // Gearbox state
  bool reverse_gear;

  // Climate data
  bool rear_defroster;
  bool air_conditioning;
  bool fan_active;

  // Lights data
  bool parking_lights;
  bool low_beam;
  bool high_beam;
  bool turn_signal_left;
  bool turn_signal_right;
  bool front_fog_lights;
  bool rear_fog_light;

  // Doors data
  bool door_driver;
  bool door_passenger;
  bool door_rear_left;
  bool door_rear_right;
  bool trunk;

  // Safety
  bool seatbelt;
  pthread_mutex_t mutex;
} VehicleState;

extern VehicleState global_vehicle_state;

/* @brief Sets the corrisponding CAN IDs frame structs to the corrisponding
 * wrapper decoder functions and expected DLCs.
 * */
void decoder_init(void);

/* @brief Calls the corrisponding wrapper decoder function for the
 * recevied can_frame.
 * @param[in] The can frame to decode
 * @return 0 in case of successful decoding
 * @return -1 if the value is out of range
 * @return -2 if the decoder function returns EINVAL
 * @return 1 if there's no corrisponding decoder function linked to a CAN ID
 * frame
 * */
int process_can_frame(struct can_frame *frame);
