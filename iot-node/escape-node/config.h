// Konfigurace IoT Node – piny a parametry podle docs/03-application-model/iot-node.md (kap. 2)
// a skutečného zapojení v iot-hardware.md.
#pragma once

#define NODE_ID     "node1"   // prefix všech hwId; u dalšího nodu změnit (node2, …)
#define FW_VERSION  "1.0.0"

// --- piny (MVP) ---
const uint8_t PIN_BUTTONS[] = {2, 3, 4};    // tlačítka 1–3 → node1.btn1–btn3
const uint8_t PIN_LEDS[]    = {22, 23};     // zelená, červená → node1.led1, led2
const uint8_t PIN_DHT       = 5;            // DHT11 DATA → node1.temp1
// GY-521: I2C na pinech 20 (SDA) a 21 (SCL), knihovna Wire je volí sama
// Klávesnice (D30–D37), enkodér (D6–D8) a LCD (D40–D45) jsou rozšíření; firmware MVP je nechává jako vstupy.

const uint8_t BUTTON_COUNT = sizeof(PIN_BUTTONS);
const uint8_t LED_COUNT    = sizeof(PIN_LEDS);

const uint8_t MPU_ADDR = 0x68;              // I2C adresa GY-521 (AD0 nezapojeno)

// --- komunikace ---
const unsigned long SERIAL_BAUD = 115200;   // musí sedět s gateway (iot-protocol.md kap. 1)
const uint8_t RX_BUFFER = 128;              // max. délka povelu od gateway včetně \n

// --- časování a prahy ---
const unsigned long DEBOUNCE_MS          = 30;     // ošetření zákmitů tlačítek
const unsigned long ACCEL_PERIOD_MS      = 50;     // čtení akcelerometru (20 Hz)
const int           TILT_DEADBAND_DEG    = 5;      // minimální změna náklonu pro odeslání
const unsigned long TILT_MIN_INTERVAL_MS = 200;    // nejvýš 5 zpráv tilt za sekundu
const float         MOVE_THRESHOLD_G     = 0.3;    // odchylka od 1 g = pohyb
const unsigned long MOVE_COOLDOWN_MS     = 1000;   // pauza po hlášení pohybu
const unsigned long TEMP_PERIOD_MS       = 10000;  // vzorek teploty (DHT11 smí nejvýš 1× za 2 s)
const uint8_t       TEMP_FAIL_LIMIT      = 3;      // neúspěšná čtení po sobě → teploměr mimo hello
const int           TEMP_MIN_C           = 0;      // rozsah DHT11
const int           TEMP_MAX_C           = 50;
const unsigned long HB_PERIOD_MS         = 5000;   // heartbeat nodu
const unsigned long SENSOR_RETRY_MS      = 5000;   // opakování inicializace GY-521
const unsigned long BLINK_HALF_PERIOD_MS = 500;    // blikání LED 1 Hz
