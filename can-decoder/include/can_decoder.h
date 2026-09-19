#pragma once
#include <bits/pthreadtypes.h>
#include <linux/can.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

#define CAN_11B_IDS 2048

#pragma pack(push, 1)
typedef struct {
  // Engine data
  uint16_t engine_rpm;
  uint8_t vehicle_speed;

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
} VehiclePayloadState;
#pragma pack(pop)

typedef struct {
  VehiclePayloadState state;
  pthread_mutex_t mutex;
} VehicleState;

extern VehicleState global_vehicle;

/* @brief Sets the corrisponding CAN IDs frame structs to the corrisponding
 * wrapper decoder functions and expected DLCs.
 * */
void decoder_init(void);

void *decoder_loop(void *b);
