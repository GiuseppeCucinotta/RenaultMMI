#include "can_decoder.h"
#include "grand_modus.h"

#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Tracks the current vehicle state
VehicleState global_vehicle_state;

// Prototype of wrapper decoder function pointer
typedef int (*DecoderWrapper)(const uint8_t *data, size_t dlc);

typedef struct {
  DecoderWrapper wrapper;
  size_t dlc;
  bool active;
} CanDecoderRouter;

// Decode table
static CanDecoderRouter can_table[CAN_11B_IDS] = {0};

/* @brief Wrapper decoding function that write on VehicleState struct engine rpm
 * @param[in] data received from the frame
 * @param[in] data lenght
 * @return 0 in case of no errors; -1 if engine rpm are out of range; -2 if
 * unpack returns EINVAL
 */
static int wrapper_decode_engine(const uint8_t *data, size_t dlc) {

  struct grand_modus_engine_t raw_engine_msg;
  if (grand_modus_engine_unpack(&raw_engine_msg, data, dlc) == 0) {
    double decoded_rpm =
        grand_modus_engine_engine_rpm_decode(raw_engine_msg.engine_rpm);

    if (grand_modus_engine_engine_rpm_is_in_phys_range(decoded_rpm)) {
      pthread_mutex_lock(&global_vehicle_state.mutex);
      global_vehicle_state.engine_rpm = decoded_rpm;
      pthread_mutex_unlock(&global_vehicle_state.mutex);
    } else {
      return -1;
    }
  } else {
    return -2;
  }
  return 0;
}

/* @brief Wrapper decoding function that write on VehicleState struct the state
 * of the brakes
 * @param[in] data received from the frame
 * @param[in] data lenght
 * @return 0 in case of no errors; -2 if unpack returns EINVAL
 */
static int wrapper_decode_brakes(const uint8_t *data, size_t dlc) {
  struct grand_modus_brakes_t raw_brakes_msg;
  if (grand_modus_brakes_unpack(&raw_brakes_msg, data, dlc) == 0) {
    pthread_mutex_lock(&global_vehicle_state.mutex);
    global_vehicle_state.parking_brake = (bool)raw_brakes_msg.parking_brake;
    pthread_mutex_unlock(&global_vehicle_state.mutex);
  } else {
    return -2;
  }
  return 0;
}

/* @brief Wrapper decoding function that write on VehicleState struct the state
 * of the Gearbox
 * @param[in] data received from the frame
 * @param[in] data lenght
 * @return 0 in case of no errors; -2 if unpack returns EINVAL
 */
static int wrapper_decode_gearbox(const uint8_t *data, size_t dlc) {
  struct grand_modus_gearbox_t raw_gearbox_msg;
  if (grand_modus_gearbox_unpack(&raw_gearbox_msg, data, dlc) == 0) {
    pthread_mutex_lock(&global_vehicle_state.mutex);

    global_vehicle_state.reverse_gear = (bool)raw_gearbox_msg.reverse_gear;

    pthread_mutex_unlock(&global_vehicle_state.mutex);
  } else {
    return -2;
  }
  return 0;
}

/* @brief Wrapper decoding function that write on VehicleState struct the state
 * of the climate
 * @param[in] data received from the frame
 * @param[in] data lenght
 * @return 0 in case of no errors; -2 if unpack returns EINVAL
 */
static int wrapper_decode_climate(const uint8_t *data, size_t dlc) {
  struct grand_modus_climate_t raw_climate_msg;
  if (grand_modus_climate_unpack(&raw_climate_msg, data, dlc) == 0) {
    pthread_mutex_lock(&global_vehicle_state.mutex);

    global_vehicle_state.air_conditioning =
        (bool)raw_climate_msg.air_conditioning;
    global_vehicle_state.rear_defroster = (bool)raw_climate_msg.rear_defroster;
    global_vehicle_state.fan_active = (bool)raw_climate_msg.fan_active;
    pthread_mutex_unlock(&global_vehicle_state.mutex);
  } else {
    return -2;
  }
  return 0;
}

/* @brief Wrapper decoding function that write on VehicleState struct the state
 * of lights and doors
 * @param[in] data received from the frame
 * @param[in] data lenght
 * @return 0 in case of no errors; -2 if unpack returns EINVAL
 */
static int wrapper_decode_lights_and_doors(const uint8_t *data, size_t dlc) {
  struct grand_modus_lights_and_doors_t raw_ld_msg;
  if (grand_modus_lights_and_doors_unpack(&raw_ld_msg, data, dlc) == 0) {
    pthread_mutex_lock(&global_vehicle_state.mutex);

    // Lights
    global_vehicle_state.parking_lights = (bool)raw_ld_msg.parking_lights;
    global_vehicle_state.low_beam = (bool)raw_ld_msg.low_beams;
    global_vehicle_state.high_beam = (bool)raw_ld_msg.high_beams;
    global_vehicle_state.front_fog_lights = (bool)raw_ld_msg.front_fog_lights;
    global_vehicle_state.rear_fog_light = (bool)raw_ld_msg.rear_fog_light;

    // Doors
    global_vehicle_state.door_driver = (bool)raw_ld_msg.door_driver;
    global_vehicle_state.door_passenger = (bool)raw_ld_msg.door_passenger;
    global_vehicle_state.door_rear_left = (bool)raw_ld_msg.door_rear_left;
    global_vehicle_state.door_rear_right = (bool)raw_ld_msg.door_rear_right;

    global_vehicle_state.trunk = (bool)raw_ld_msg.trunk;
    pthread_mutex_unlock(&global_vehicle_state.mutex);
  } else {
    return -2;
  }
  return 0;
}

void decoder_init(void) {
  // Engine decoder
  can_table[GRAND_MODUS_ENGINE_FRAME_ID].wrapper = wrapper_decode_engine;
  can_table[GRAND_MODUS_ENGINE_FRAME_ID].dlc = GRAND_MODUS_ENGINE_LENGTH;

  // Brakes decoder
  can_table[GRAND_MODUS_BRAKES_FRAME_ID].wrapper = wrapper_decode_brakes;
  can_table[GRAND_MODUS_BRAKES_FRAME_ID].dlc = GRAND_MODUS_BRAKES_LENGTH;

  // Gearbox decoder
  can_table[GRAND_MODUS_GEARBOX_FRAME_ID].wrapper = wrapper_decode_gearbox;
  can_table[GRAND_MODUS_GEARBOX_LENGTH].dlc = GRAND_MODUS_GEARBOX_LENGTH;

  // Climate decoder
  can_table[GRAND_MODUS_CLIMATE_FRAME_ID].wrapper = wrapper_decode_climate;
  can_table[GRAND_MODUS_CLIMATE_FRAME_ID].dlc = GRAND_MODUS_CLIMATE_LENGTH;

  // Lights and doors decoder
  can_table[GRAND_MODUS_LIGHTS_AND_DOORS_FRAME_ID].wrapper =
      wrapper_decode_lights_and_doors;
  can_table[GRAND_MODUS_LIGHTS_AND_DOORS_FRAME_ID].dlc =
      GRAND_MODUS_LIGHTS_AND_DOORS_LENGTH;
}

int process_can_frame(struct can_frame *frame) {
  uint32_t id = frame->can_id;

  if (id < CAN_11B_IDS && can_table[id].wrapper != NULL) {
    if (frame->can_dlc == can_table[id].dlc)
      return can_table[id].wrapper(frame->data, frame->can_dlc);
  }
  return 1;
}
