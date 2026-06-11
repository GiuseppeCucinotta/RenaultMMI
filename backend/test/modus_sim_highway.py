import math


def simula_autostrada(filename="autostrada.log", duration_sec=150):
    fps = 50
    dt = 1.0 / fps
    base_time = 1718000000.000000

    with open(filename, "w") as f:
        rpm = 1500.0
        speed = 40.0  # Partiamo già in movimento sulla corsia di accelerazione

        for frame in range(duration_sec * fps):
            t = frame * dt
            timestamp = base_time + t
            left_signal = False
            right_signal = False

            # --- FISICA DIESEL (Rapporti lunghi) ---
            if speed < 40:
                rpm = 1200 + ((speed - 20) * 55)
            elif speed < 80:  # 3° Marcia (Tirata fino a ~3000 rpm per immettersi)
                rpm = 1400 + ((speed - 40) * 40)
            elif speed < 120:  # 4° Marcia
                rpm = 1800 + ((speed - 80) * 30)
            else:  # 5°/6° Marcia di riposo
                rpm = 2100 + ((speed - 120) * 22)

            # --- COPIONE AUTOSTRADALE ---
            if t < 5:
                # Sulla rampa, si prepara la freccia
                left_signal = True
            elif t < 25:
                # Immissione aggressiva (da 40 a 110 km/h)
                left_signal = t < 10  # Spegne la freccia dopo essersi immesso
                speed += 3.5 * dt
            elif t < 50:
                # Si stabilizza a 130 km/h
                speed = min(130, speed + 1.0 * dt)
            elif t < 70:
                # Crociera a 130 km/h
                speed = 130 + math.sin(t) * 1.5
            elif t < 120:
                # Sorpasso e spinta massima verso i 175 km/h
                speed = min(175, speed + 1.2 * dt)
            else:
                # Decelerazione
                speed -= 2.0 * dt

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


if __name__ == "__main__":
    simula_autostrada()
    print("Log autostradale generato con successo.")
