import math


def simula_urbano(filename="urbano.log", duration_sec=180):
    fps = 50
    dt = 1.0 / fps
    base_time = 1718000000.000000

    with open(filename, "w") as f:
        rpm = 802.0
        speed = 0.0

        for frame in range(duration_sec * fps):
            t = frame * dt
            timestamp = base_time + t

            # --- FISICA DIESEL & MARCE ---
            # Calcolo dei giri in base alla marcia e alla velocità
            if speed == 0:
                rpm = 802.0
            elif speed < 20:  # 1° Marcia
                rpm = 802 + (speed * 80)
            elif speed < 40:  # 2° Marcia (cambiata a ~2400 rpm)
                rpm = 1200 + ((speed - 20) * 55)
            elif speed < 60:  # 3° Marcia (cambiata a ~2300 rpm)
                rpm = 1400 + ((speed - 40) * 40)
            else:  # 4° Marcia
                rpm = 1500 + ((speed - 60) * 30)

            # --- COPIONE URBANO ---
            right_signal = False
            left_signal = False
            if t < 5:
                speed = 0
            elif t < 30:
                # Accelera fino a 45 km/h
                speed += 1.8 * dt
            elif t < 60:
                # Crociera a 45 km/h
                speed = 45 + math.sin(t) * 1.5
            elif t < 70:
                # Frena per svoltare
                right_signal = True
                speed = max(15, speed - 3 * dt)
            elif t < 80:
                # Riparte dopo la curva
                speed = min(55, speed + 2 * dt)
            elif t < 120:
                speed = 55 + math.sin(t) * 1.5
            else:
                # Frena fino a fermarsi
                speed = max(0, speed - 2.5 * dt)

            # --- CODIFICA CAN ---
            rpm_raw = max(0, min(65535, int(rpm / 0.125)))
            d0_d1 = f"{rpm_raw:04X}"
            speed_raw = max(0, min(255, int(speed)))
            d7 = f"{speed_raw:02X}"

            f.write(f"({timestamp:.6f}) vcan0 181#{d0_d1}0000000000{d7}\n")

            # --- LUCI E FRECCE (ID 1549 -> 60D Hex) ---
            if frame % 5 == 0:
                # Frequenza reale automotive: 1.5 Hz (circa 0.33s ON, 0.33s OFF)
                blink_attivo = (t % 0.666) < 0.333

                byte0 = 0x02  # Anabbaglianti sempre accesi
                byte1 = 0x00  # Partiamo con le frecce spente

                # Applichiamo le maschere di bit solo se siamo nella fase ON del lampeggio
                if left_signal and blink_attivo:
                    byte1 |= 0x20  # Bit 13 (Freccia Sinistra)
                if right_signal and blink_attivo:
                    byte1 |= 0x40  # Bit 14 (Freccia Destra)

                f.write(
                    f"({timestamp:.6f}) vcan0 60D#{byte0:02X}{byte1:02X}000000000000\n"
                )

            # --- CLIMA (ID 884 -> 374 Hex) ---
            # Al secondo 40 il conducente accende il climatizzatore automatico
            if frame % 10 == 0:
                if 40 < t < 150:
                    # Byte 1: bit 4 (AC) e bit 5 (Fan) = 00110000 binario = 0x30
                    f.write(f"({timestamp:.6f}) vcan0 374#003000\n")
                else:
                    # Tutto spento
                    f.write(f"({timestamp:.6f}) vcan0 374#000000\n")


if __name__ == "__main__":
    simula_urbano()
    print("Log urbano generato con successo.")
